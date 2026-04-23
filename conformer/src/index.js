'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseArgs } = require('util');
const { discoverCorpus } = require('./corpus');
const { compareResults } = require('./compare');
const { DockerDriver } = require('./driver');
const { loadRegistry, filterDrivers } = require('./registry');
const { ResultsStore } = require('../../results');

function generateRunId() {
  const now = new Date();
  return now.toISOString().replace(/:/g, '-').replace(/\./g, '-').replace(/Z$/, 'Z');
}

function parseConcurrency(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

async function runWithConcurrency(limit, items, fn) {
  const results = new Array(items.length);
  const effective = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  const workers = [];
  for (let w = 0; w < effective; w += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function computeCorpusFingerprint(tests) {
  const keys = tests.map((t) => `${t.testId}/${t.queryId}`).sort();
  return crypto.createHash('sha256').update(keys.join('\n')).digest('hex');
}

function parseCsv(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      drivers: { type: 'string' },
      exclude: { type: 'string' },
      registry: { type: 'string' },
      'build-from-source': { type: 'boolean' },
      image: { type: 'string' },
      'corpus-dir': { type: 'string' },
      force: { type: 'boolean' },
    },
    strict: false,
  });
  return {
    only: parseCsv(values.drivers),
    exclude: parseCsv(values.exclude),
    registryPath: values.registry,
    buildFromSource: Boolean(values['build-from-source']),
    imageOverride: values.image,
    corpusDir: values['corpus-dir'],
    force: Boolean(values.force),
  };
}

async function createDockerSession(driver, runId, { buildFromSource, imageOverride } = {}) {
  const manifest = JSON.parse(fs.readFileSync(driver.manifestPath, 'utf8'));
  if (!manifest.runtime) manifest.runtime = {};
  if (imageOverride) {
    manifest.image = { repository: imageOverride.split(':')[0], tag: imageOverride.split(':')[1] || 'latest' };
  } else if (buildFromSource && manifest.image && manifest.image.repository) {
    delete manifest.image.repository;
  }
  const dockerDriver = new DockerDriver({
    name: driver.name,
    implDir: driver.implDir,
    manifest,
    runId,
  });
  await dockerDriver.ensureImage({ onProgress: () => { /* silence */ } });
  await dockerDriver.start();
  return {
    version: dockerDriver.libraryVersion,
    imageDigest: dockerDriver.imageDigest || 'unknown',
    async execute(test) { return dockerDriver.execute(test); },
    async stop() { await dockerDriver.stop(); },
  };
}

function resolveRegistry(rootDir, cli) {
  const registryPath = cli.registryPath || process.env.REGISTRY_PATH || path.join(rootDir, 'registry.json');
  if (!fs.existsSync(registryPath)) {
    throw new Error(`no registry.json at ${registryPath}`);
  }
  return loadRegistry({ registryPath, rootDir });
}

async function runConformance({ argv = [], createSession = createDockerSession, rootDir } = {}) {
  const baseDir = path.resolve(__dirname, '..');
  const resolvedRoot = rootDir || path.resolve(baseDir, '..');
  const cli = parseCliArgs(argv);
  const fullRegistry = resolveRegistry(resolvedRoot, cli);
  const registry = filterDrivers(fullRegistry, { only: cli.only, exclude: cli.exclude });

  const corpusDir = cli.corpusDir || process.env.CORPUS_DIR || path.join(resolvedRoot, 'corpus');
  const tests = discoverCorpus(corpusDir);
  const corpusFingerprint = computeCorpusFingerprint(tests);

  const reference = registry.byName.get(registry.reference);
  if (!reference) {
    throw new Error(`Reference driver "${registry.reference}" not in filtered driver set.`);
  }
  const conformants = registry.drivers.filter((d) => d.name !== registry.reference);

  if (tests.length === 0) {
    throw new Error('No test cases found in corpus.');
  }

  process.stderr.write(`Found ${tests.length} test case(s)\n`);

  const runId = generateRunId();
  const sessionOptions = {
    buildFromSource: cli.buildFromSource,
    imageOverride: cli.imageOverride,
  };

  process.stderr.write(`Starting session for reference (${reference.name})...\n`);
  const refSession = await createSession(reference, runId, sessionOptions);
  const refVersion = refSession.version;
  const refImageDigest = refSession.imageDigest;

  const conformantSessions = {};
  const conformantVersions = {};
  const conformantImageDigests = {};
  try {
    const concurrency = parseConcurrency(process.env.CONFORMER_CONCURRENCY) || conformants.length;
    if (conformants.length > 0) {
      process.stderr.write(
        `Starting ${conformants.length} conformant session(s) (concurrency ${Math.min(concurrency, conformants.length)})...\n`,
      );
    }
    const settled = await runWithConcurrency(concurrency, conformants, async (conformant) => {
      const t0 = Date.now();
      const session = await createSession(conformant, runId, sessionOptions);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      process.stderr.write(`  ready ${conformant.name} (${dt}s)\n`);
      return session;
    });
    const startupFailures = [];
    for (let i = 0; i < conformants.length; i += 1) {
      const conformant = conformants[i];
      const result = settled[i];
      if (result.status === 'fulfilled') {
        const session = result.value;
        conformantSessions[conformant.name] = session;
        conformantVersions[conformant.name] = session.version;
        conformantImageDigests[conformant.name] = session.imageDigest;
      } else {
        startupFailures.push({ name: conformant.name, reason: result.reason });
      }
    }
    if (startupFailures.length > 0) {
      const names = startupFailures.map((f) => f.name).join(', ');
      const firstReason = startupFailures[0].reason;
      const message = firstReason && firstReason.message ? firstReason.message : String(firstReason);
      throw new Error(`Failed to start conformant session(s) [${names}]: ${message}`);
    }

    const conformantTests = {};
    for (const conformant of conformants) {
      conformantTests[conformant.name] = {};
    }

    const resultsDir = process.env.RESULTS_DIR || path.join(resolvedRoot, 'results', 'data');
    const store = ResultsStore.fromDirectory(resultsDir);
    const skippedConformants = {};
    const priorRun = store.loadLatestRunSummary();

    const corpusUnchanged = priorRun && priorRun.reference.corpusFingerprint === corpusFingerprint;
    if (priorRun && !corpusUnchanged) {
      process.stderr.write('Corpus changed since prior run; will re-run all conformants.\n');
    }
    if (cli.force && priorRun) {
      process.stderr.write('Force flag set; re-running all conformants regardless of prior run.\n');
    }

    const conformantsToRun = conformants.filter((conformant) => {
      const currentDigest = conformantImageDigests[conformant.name];
      if (
        !cli.force &&
        priorRun &&
        priorRun.reference.hasExclusionMetadata &&
        priorRun.reference.imageDigest === refImageDigest &&
        corpusUnchanged &&
        priorRun.conformants[conformant.name] &&
        priorRun.conformants[conformant.name].imageDigest === currentDigest
      ) {
        const digestForLog = currentDigest || 'unknown';
        process.stderr.write(`Skipping conformant (${conformant.name}): unchanged (image ${digestForLog.slice(0, 14)})\n`);
        skippedConformants[conformant.name] = priorRun.conformants[conformant.name].failuresByTestKey;
        return false;
      }
      return true;
    });

    const referenceExclusions = [];
    let runnableCount = 0;

    if (conformantsToRun.length === 0) {
      process.stderr.write('All conformants unchanged, skipping test execution.\n');
    } else {
      for (const test of tests) {
        const { testId, queryId } = test;

        process.stderr.write(`  test ${testId}/${queryId}: running reference (${reference.name})...\n`);
        const refResult = await refSession.execute(test);

        if (refResult.error) {
          process.stderr.write(`    reference excluded: ${refResult.error}\n`);
          const exclusion = { testKey: `${testId}/${queryId}`, error: refResult.error };
          if (refResult.stderr) exclusion.stderr = refResult.stderr;
          referenceExclusions.push(exclusion);
          continue;
        }

        const refErrors = refResult.result && Array.isArray(refResult.result.errors)
          ? refResult.result.errors
          : null;
        if (refErrors && refErrors.length > 0) {
          process.stderr.write(`    reference excluded: returned ${refErrors.length} GraphQL error(s)\n`);
          referenceExclusions.push({
            testKey: `${testId}/${queryId}`,
            response: refResult.result,
          });
          continue;
        }

        runnableCount += 1;
        await Promise.all(conformantsToRun.map(async (conformant) => {
          const session = conformantSessions[conformant.name];
          const conformantResult = await session.execute(test);
          const result = compareResults(refResult, conformantResult);
          if (!result.matches) {
            if (refResult.result) result.expected = refResult.result;
            if (conformantResult.result) result.actual = conformantResult.result;
            if (conformantResult.error) result.error = conformantResult.error;
            if (conformantResult.stderr) result.stderr = conformantResult.stderr;
          }
          conformantTests[conformant.name][`${testId}/${queryId}`] = result;
        }));
      }
    }

    for (const [name, tests] of Object.entries(skippedConformants)) {
      conformantTests[name] = Object.fromEntries(
        Object.keys(tests).map((testKey) => [testKey, { matches: false }]),
      );
    }

    const timestamp = new Date().toISOString();

    const conformantResults = {};
    for (const conformant of conformants) {
      const entry = {
        version: conformantVersions[conformant.name],
        imageDigest: conformantImageDigests[conformant.name],
      };
      if (skippedConformants[conformant.name] && priorRun) {
        const prior = priorRun.conformants[conformant.name];
        if (prior) {
          entry.total = prior.total;
          entry.passed = prior.passed;
          entry.failuresByTestKey = prior.failuresByTestKey;
        }
      } else {
        entry.tests = conformantTests[conformant.name];
      }
      if (skippedConformants[conformant.name] && priorRun) {
        const prior = priorRun.conformants[conformant.name];
        if (prior && prior.quirksByTestKey) {
          entry.quirksByTestKey = prior.quirksByTestKey;
        }
      }
      conformantResults[conformant.name] = entry;
    }

    if (conformantsToRun.length === 0 && priorRun) {
      runnableCount = priorRun.reference.total || 0;
      if (priorRun.reference.exclusions) {
        referenceExclusions.push(...priorRun.reference.exclusions);
      }
    }

    const runResult = {
      id: runId,
      timestamp,
      reference: {
        name: reference.name,
        version: refVersion,
        imageDigest: refImageDigest,
        scoringModel: 'runnable-set-v1',
        corpusTotal: tests.length,
        corpusFingerprint,
        total: runnableCount,
        errors: 0,
        excluded: referenceExclusions.length,
        exclusions: referenceExclusions,
      },
      conformants: conformantResults,
    };

    store.recordRun(runResult);
    process.stderr.write(`Results written to ${resultsDir}\n`);

    const summary = store.getSummary();
    if (summary.length > 0) {
      const refTotal = runResult.reference.total || 0;
      const refExcluded = runResult.reference.excluded || 0;
      const refPct = refTotal > 0 ? '100.0' : '100.0';

      const allRows = [
        { impl: reference.name, passed: refTotal, total: refTotal, pct: refPct, failed: 0 },
        ...summary.map((s) => ({
          impl: s.impl, passed: s.total - s.failed, total: s.total,
          pct: s.passPct.toFixed(1), failed: s.failed,
        })),
      ];
      const nameWidth = Math.max(...allRows.map((r) => r.impl.length));
      process.stderr.write('\n');
      process.stderr.write(
        `  ${'Impl'.padEnd(nameWidth)}  ${'Pass'.padStart(4)}/${'Total'.padStart(5)}   ${'Rate'.padStart(5)}  Status\n`,
      );
      process.stderr.write(`  ${'-'.repeat(nameWidth)}  ${'-'.repeat(4)} ${'-'.repeat(5)}  ${'-'.repeat(6)}  ${'-'.repeat(6)}\n`);
      for (const r of allRows) {
        const status = r.failed === 0 ? 'PASS' : 'FAIL';
        process.stderr.write(
          `  ${r.impl.padEnd(nameWidth)}  ${String(r.passed).padStart(4)}/${String(r.total).padStart(5)}  ${r.pct.padStart(6)}%  ${status}\n`,
        );
      }
      if (refExcluded > 0) {
        process.stderr.write(`  Reference excluded ${refExcluded}/${tests.length} test(s) from scoring.\n\n`);
      } else {
        process.stderr.write('\n');
      }
    }

    return runResult;
  } finally {
    const stopPromises = [refSession.stop()];
    for (const session of Object.values(conformantSessions)) {
      stopPromises.push(session.stop());
    }
    await Promise.allSettled(stopPromises);
  }
}

async function main(argv = process.argv.slice(2)) {
  await runConformance({ argv });
}

module.exports = {
  computeCorpusFingerprint,
  parseCliArgs,
  parseConcurrency,
  runConformance,
  runWithConcurrency,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(1);
  });
}
