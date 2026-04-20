'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseArgs } = require('util');
const { discoverCorpus } = require('./corpus');
const { runHarness } = require('./runner');
const { getVersion } = require('./builder');
const { compareResults } = require('./compare');
const { DockerDriver } = require('./driver');
const { loadRegistry, loadConfigAsRegistry, filterDrivers } = require('./registry');
const { ResultsStore } = require('../../results');

function generateRunId() {
  const now = new Date();
  return now.toISOString().replace(/:/g, '-').replace(/\./g, '-').replace(/Z$/, 'Z');
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
      config: { type: 'string' },
      'build-from-source': { type: 'boolean' },
      image: { type: 'string' },
      'corpus-dir': { type: 'string' },
    },
    strict: false,
  });
  return {
    only: parseCsv(values.drivers),
    exclude: parseCsv(values.exclude),
    registryPath: values.registry,
    configPath: values.config,
    buildFromSource: Boolean(values['build-from-source']),
    imageOverride: values.image,
    corpusDir: values['corpus-dir'],
  };
}

async function createSubprocessSession(driver) {
  const version = getVersion(driver.implDir);
  return {
    mode: 'subprocess',
    version,
    async execute(test) {
      const args = test.variablesPath
        ? [test.schemaPath, test.queryPath, test.variablesPath]
        : [test.schemaPath, test.queryPath];
      return runHarness(driver.command, driver.implDir, args);
    },
    async stop() { /* nothing persistent */ },
  };
}

async function createHttpSession(driver, runId, { buildFromSource, imageOverride } = {}) {
  const manifest = JSON.parse(fs.readFileSync(driver.manifestPath, 'utf8'));
  if (!manifest.runtime) manifest.runtime = {};
  if (imageOverride) {
    manifest.image = { repository: imageOverride.split(':')[0], tag: imageOverride.split(':')[1] || 'latest' };
  } else if (buildFromSource && manifest.image && manifest.image.repository) {
    // Force local build even if repository is present
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
    mode: 'http',
    version: dockerDriver.imageDigest || 'unknown',
    async execute(test) { return dockerDriver.execute(test); },
    async stop() { await dockerDriver.stop(); },
  };
}

async function createSession(driver, runId, options) {
  if (driver.transport === 'http') return createHttpSession(driver, runId, options);
  return createSubprocessSession(driver);
}

function resolveRegistry(rootDir, cli) {
  const explicitRegistry = cli.registryPath || process.env.REGISTRY_PATH;
  const explicitConfig = cli.configPath || process.env.CONFIG_PATH;

  // Explicit config without registry → legacy config.json mode (no deprecation noise).
  if (explicitConfig && !explicitRegistry) {
    return loadConfigAsRegistry({ configPath: explicitConfig, rootDir });
  }

  const registryPath = explicitRegistry || path.join(rootDir, 'registry.json');
  const configPath = explicitConfig || path.join(rootDir, 'config.json');

  if (fs.existsSync(registryPath)) {
    return loadRegistry({ registryPath, configPath, rootDir });
  }
  if (fs.existsSync(configPath)) {
    process.stderr.write(`registry.json not found at ${registryPath}; falling back to config.json (deprecated)\n`);
    return loadConfigAsRegistry({ configPath, rootDir });
  }
  throw new Error(`no registry.json at ${registryPath} and no config.json at ${configPath}`);
}

async function main(argv = process.argv.slice(2)) {
  const baseDir = path.resolve(__dirname, '..');
  const rootDir = path.resolve(baseDir, '..');
  const cli = parseCliArgs(argv);
  const fullRegistry = resolveRegistry(rootDir, cli);
  const registry = filterDrivers(fullRegistry, { only: cli.only, exclude: cli.exclude });

  const corpusDir = cli.corpusDir || process.env.CORPUS_DIR || path.join(rootDir, 'corpus');
  const tests = discoverCorpus(corpusDir);
  const corpusFingerprint = computeCorpusFingerprint(tests);

  const reference = registry.byName.get(registry.reference);
  if (!reference) {
    process.stderr.write(`Reference driver "${registry.reference}" not in filtered driver set.\n`);
    process.exit(1);
  }
  const conformants = registry.drivers.filter((d) => d.name !== registry.reference);

  if (tests.length === 0) {
    process.stderr.write('No test cases found in corpus.\n');
    process.exit(1);
  }

  process.stderr.write(`Found ${tests.length} test case(s)\n`);

  const runId = generateRunId();
  const sessionOptions = {
    buildFromSource: cli.buildFromSource,
    imageOverride: cli.imageOverride,
  };

  process.stderr.write(`Starting session for reference (${reference.name})...\n`);
  const refSession = await createSession(reference, runId, sessionOptions);
  const refSha = refSession.version;

  const conformantSessions = {};
  const conformantVersions = {};
  try {
    for (const conformant of conformants) {
      process.stderr.write(`Starting session for conformant (${conformant.name})...\n`);
      const session = await createSession(conformant, runId, sessionOptions);
      conformantSessions[conformant.name] = session;
      conformantVersions[conformant.name] = session.version;
    }

    const conformantTests = {};
    for (const conformant of conformants) {
      conformantTests[conformant.name] = {};
    }

    const resultsDir = process.env.RESULTS_DIR || path.join(rootDir, 'results', 'data');
    const store = ResultsStore.fromDirectory(resultsDir);
    const skippedConformants = {};
    const priorRun = store.loadLatestRunSummary();

    const corpusUnchanged = priorRun && priorRun.reference.corpusFingerprint === corpusFingerprint;
    if (priorRun && !corpusUnchanged) {
      process.stderr.write('Corpus changed since prior run; will re-run all conformants.\n');
    }

    const conformantsToRun = conformants.filter((conformant) => {
      const currentSha = conformantVersions[conformant.name];
      if (
        priorRun &&
        priorRun.reference.hasExclusionMetadata &&
        priorRun.reference.sha === refSha &&
        corpusUnchanged &&
        priorRun.conformants[conformant.name] &&
        priorRun.conformants[conformant.name].sha === currentSha
      ) {
        process.stderr.write(`Skipping conformant (${conformant.name}): unchanged (sha ${currentSha.slice(0, 7)})\n`);
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
      const entry = { sha: conformantVersions[conformant.name] };
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
        sha: refSha,
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
  } finally {
    const stopPromises = [refSession.stop()];
    for (const session of Object.values(conformantSessions)) {
      stopPromises.push(session.stop());
    }
    await Promise.allSettled(stopPromises);
  }
}

module.exports = { computeCorpusFingerprint, parseCliArgs };

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(1);
  });
}
