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

const SCORING_MODEL = 'runnable-set-v1';
const MANIFEST_REPO_BASE = 'https://github.com/jbellenger/graphql-conformance/blob/master';

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

// Deterministic per-result ID. Stable across re-runs of the same
// (run, impl, testCase) triple so the D1 migration can adopt these as
// primary keys without reshuffling.
function resultId(runId, implId, testCaseId) {
  const digest = crypto
    .createHash('sha256')
    .update(`${runId}|${implId}|${testCaseId}`)
    .digest('hex');
  const hex = digest.slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function readManifestFile(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return {};
  }
}

// Build the Impl record the site consumes. Merges registry entry + manifest
// content + the runtime-reported version. Mirrors site/src/repository/types.ts.
function buildImpl({ driver, manifest, version, rootDir }) {
  const versionUrlTemplate = manifest.versionUrlTemplate;
  const versionUrl = version && versionUrlTemplate
    ? versionUrlTemplate.replace(/\{version\}/g, encodeURIComponent(version))
    : undefined;
  const manifestUrl = driver.source === 'in-tree' && driver.manifestPath
    ? `${MANIFEST_REPO_BASE}/${path.relative(rootDir, driver.manifestPath).split(path.sep).join('/')}`
    : undefined;
  const repoUrl = manifest.homepage || driver.repoUrl;
  return {
    id: driver.name,
    name: driver.name,
    language: manifest.language || 'unknown',
    manifestUrl,
    repoUrl,
    version: version || undefined,
    versionUrl,
  };
}

function writeRunSummary(stderr, { reference, conformants, run, tests }) {
  const summaryRows = [reference, ...conformants].map((impl) => {
    const bucket = run.resultsByImpl[impl.id] || { failed: 0, excluded: 0, errored: 0 };
    const isRef = impl.id === reference.id;
    const total = isRef
      ? run.testCaseCount - bucket.excluded
      : run.testCaseCount;
    const nonPass = bucket.failed + bucket.errored + (isRef ? 0 : 0);
    const passed = Math.max(0, total - nonPass);
    const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : '100.0';
    return { impl: impl.id, passed, total, pct, failed: nonPass };
  });
  const nameWidth = Math.max(...summaryRows.map((r) => r.impl.length));
  stderr('\n');
  stderr(
    `  ${'Impl'.padEnd(nameWidth)}  ${'Pass'.padStart(4)}/${'Total'.padStart(5)}   ${'Rate'.padStart(5)}  Status\n`,
  );
  stderr(
    `  ${'-'.repeat(nameWidth)}  ${'-'.repeat(4)} ${'-'.repeat(5)}  ${'-'.repeat(6)}  ${'-'.repeat(6)}\n`,
  );
  for (const r of summaryRows) {
    const status = r.failed === 0 ? 'PASS' : 'FAIL';
    stderr(
      `  ${r.impl.padEnd(nameWidth)}  ${String(r.passed).padStart(4)}/${String(r.total).padStart(5)}  ${r.pct.padStart(6)}%  ${status}\n`,
    );
  }
  const refExcluded = (run.resultsByImpl[reference.id] || {}).excluded || 0;
  if (refExcluded > 0) {
    stderr(`  Reference excluded ${refExcluded}/${tests.length} test(s) from scoring.\n\n`);
  } else {
    stderr('\n');
  }
}

async function runConformance({ argv = [], createSession = createDockerSession, rootDir } = {}) {
  const stderr = (chunk) => process.stderr.write(chunk);
  const baseDir = path.resolve(__dirname, '..');
  const resolvedRoot = rootDir || path.resolve(baseDir, '..');
  const cli = parseCliArgs(argv);
  const fullRegistry = resolveRegistry(resolvedRoot, cli);
  const registry = filterDrivers(fullRegistry, { only: cli.only, exclude: cli.exclude });

  const corpusDir = cli.corpusDir || process.env.CORPUS_DIR || path.join(resolvedRoot, 'corpus');
  const tests = discoverCorpus(corpusDir);
  const corpusFingerprint = computeCorpusFingerprint(tests);

  const referenceDriver = registry.byName.get(registry.reference);
  if (!referenceDriver) {
    throw new Error(`Reference driver "${registry.reference}" not in filtered driver set.`);
  }
  const conformantDrivers = registry.drivers.filter((d) => d.name !== registry.reference);

  if (tests.length === 0) {
    throw new Error('No test cases found in corpus.');
  }

  stderr(`Found ${tests.length} test case(s)\n`);

  const runId = generateRunId();
  const sessionOptions = {
    buildFromSource: cli.buildFromSource,
    imageOverride: cli.imageOverride,
  };

  stderr(`Starting session for reference (${referenceDriver.name})...\n`);
  const refSession = await createSession(referenceDriver, runId, sessionOptions);

  const conformantSessions = {};
  try {
    const concurrency = parseConcurrency(process.env.CONFORMER_CONCURRENCY) || conformantDrivers.length;
    if (conformantDrivers.length > 0) {
      stderr(
        `Starting ${conformantDrivers.length} conformant session(s) (concurrency ${Math.min(concurrency, conformantDrivers.length)})...\n`,
      );
    }
    const settled = await runWithConcurrency(concurrency, conformantDrivers, async (driver) => {
      const t0 = Date.now();
      const session = await createSession(driver, runId, sessionOptions);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      stderr(`  ready ${driver.name} (${dt}s)\n`);
      return session;
    });
    const startupFailures = [];
    for (let i = 0; i < conformantDrivers.length; i += 1) {
      const driver = conformantDrivers[i];
      const settledResult = settled[i];
      if (settledResult.status === 'fulfilled') {
        conformantSessions[driver.name] = settledResult.value;
      } else {
        startupFailures.push({ name: driver.name, reason: settledResult.reason });
      }
    }
    if (startupFailures.length > 0) {
      const names = startupFailures.map((f) => f.name).join(', ');
      const firstReason = startupFailures[0].reason;
      const message = firstReason && firstReason.message ? firstReason.message : String(firstReason);
      throw new Error(`Failed to start conformant session(s) [${names}]: ${message}`);
    }

    const resultsDir = process.env.RESULTS_DIR || path.join(resolvedRoot, 'results', 'data');
    const store = ResultsStore.fromDirectory(resultsDir);
    const prior = store.loadLatestRun();
    const priorMeta = prior && prior.conformerMeta ? prior.conformerMeta : null;

    const corpusUnchanged = Boolean(priorMeta) && priorMeta.corpusFingerprint === corpusFingerprint;
    if (prior && !corpusUnchanged) {
      stderr('Corpus changed since prior run; will re-run all conformants.\n');
    }
    if (cli.force && prior) {
      stderr('Force flag set; re-running all conformants regardless of prior run.\n');
    }

    const skippedConformants = new Set();
    const conformantsToRun = conformantDrivers.filter((driver) => {
      const currentDigest = conformantSessions[driver.name].imageDigest;
      const priorImplMeta = priorMeta && priorMeta.implMeta && priorMeta.implMeta[driver.name];
      const referenceUnchanged = priorMeta && priorMeta.implMeta
        && priorMeta.implMeta[referenceDriver.name]
        && priorMeta.implMeta[referenceDriver.name].imageDigest === refSession.imageDigest;
      if (
        !cli.force
        && prior
        && corpusUnchanged
        && referenceUnchanged
        && priorImplMeta
        && priorImplMeta.imageDigest === currentDigest
        && priorMeta.scoringModel === SCORING_MODEL
      ) {
        const digestForLog = currentDigest || 'unknown';
        stderr(`Skipping conformant (${driver.name}): unchanged (image ${digestForLog.slice(0, 14)})\n`);
        skippedConformants.add(driver.name);
        return false;
      }
      return true;
    });

    const refTestResults = [];
    const conformantTestResults = {};
    for (const driver of conformantsToRun) conformantTestResults[driver.name] = [];
    let runnableCount = 0;

    const fullySkipped = conformantsToRun.length === 0 && prior && corpusUnchanged;
    if (fullySkipped) {
      stderr('All conformants unchanged, skipping test execution.\n');
    } else {
      for (const test of tests) {
        const testKey = `${test.testId}/${test.queryId}`;
        stderr(`  test ${testKey}: running reference (${referenceDriver.name})...\n`);
        const refResult = await refSession.execute(test);

        if (refResult.error) {
          stderr(`    reference excluded: ${refResult.error}\n`);
          refTestResults.push(buildResult({
            runId, implId: referenceDriver.name, testCaseId: testKey,
            status: 'excluded',
            error: refResult.error,
            stderr: refResult.stderr,
          }));
          continue;
        }

        const refErrors = refResult.result && Array.isArray(refResult.result.errors)
          ? refResult.result.errors
          : null;
        if (refErrors && refErrors.length > 0) {
          stderr(`    reference excluded: returned ${refErrors.length} GraphQL error(s)\n`);
          refTestResults.push(buildResult({
            runId, implId: referenceDriver.name, testCaseId: testKey,
            status: 'excluded',
            actual: refResult.result,
          }));
          continue;
        }

        runnableCount += 1;
        await Promise.all(conformantsToRun.map(async (driver) => {
          const session = conformantSessions[driver.name];
          const conformantResult = await session.execute(test);
          const cmp = compareResults(refResult, conformantResult);
          if (cmp.matches) return;
          const status = conformantResult.error ? 'error' : 'fail';
          conformantTestResults[driver.name].push(buildResult({
            runId, implId: driver.name, testCaseId: testKey, status,
            expected: refResult.result,
            actual: conformantResult.result,
            error: conformantResult.error,
            stderr: conformantResult.stderr,
          }));
        }));
      }
    }

    // Merge prior (skipped) conformants back in with a refreshed runId/id.
    const conformantResultsByImpl = {};
    for (const driver of conformantDrivers) {
      if (skippedConformants.has(driver.name)) {
        const priorResults = (prior && prior.resultsByImpl && prior.resultsByImpl[driver.name]) || [];
        conformantResultsByImpl[driver.name] = priorResults.map((r) => ({
          ...r,
          runId,
          id: resultId(runId, driver.name, r.testCaseId),
        }));
      } else {
        conformantResultsByImpl[driver.name] = conformantTestResults[driver.name] || [];
      }
    }

    // If fully skipped and corpus unchanged, reuse prior reference results (excluded entries).
    let referenceResults;
    if (fullySkipped && prior && prior.resultsByImpl && prior.resultsByImpl[referenceDriver.name]) {
      referenceResults = prior.resultsByImpl[referenceDriver.name].map((r) => ({
        ...r,
        runId,
        id: resultId(runId, referenceDriver.name, r.testCaseId),
      }));
    } else {
      referenceResults = refTestResults;
    }

    // testCaseCount: full corpus; preserved across runs because fingerprint
    // matching guarantees tests.length == prior run's count.
    const testCaseCount = tests.length;

    const referenceExcludedCount = referenceResults.filter((r) => r.status === 'excluded').length;

    const resultsByImpl = {
      [referenceDriver.name]: {
        implId: referenceDriver.name,
        failed: 0,
        excluded: referenceExcludedCount,
        errored: 0,
        results: [],
      },
    };
    for (const driver of conformantDrivers) {
      const rows = conformantResultsByImpl[driver.name];
      let failed = 0;
      let errored = 0;
      for (const r of rows) {
        if (r.status === 'fail') failed += 1;
        else if (r.status === 'error') errored += 1;
      }
      resultsByImpl[driver.name] = {
        implId: driver.name,
        failed,
        excluded: 0,
        errored,
        results: [],
      };
    }

    const orderedImpls = [referenceDriver, ...conformantDrivers].map((driver) => {
      const manifest = readManifestFile(driver.manifestPath);
      const session = driver.name === referenceDriver.name
        ? refSession
        : conformantSessions[driver.name];
      return buildImpl({
        driver,
        manifest,
        version: session ? session.version : null,
        rootDir: resolvedRoot,
      });
    });

    const run = {
      id: runId,
      timestamp: new Date().toISOString(),
      referenceImplId: referenceDriver.name,
      implIds: orderedImpls.map((i) => i.id),
      testCaseCount,
      resultsByImpl,
    };

    const conformerMeta = {
      corpusFingerprint,
      scoringModel: SCORING_MODEL,
      runnableCount: fullySkipped && prior
        ? ((priorMeta && priorMeta.runnableCount) || 0)
        : runnableCount,
      implMeta: Object.fromEntries([referenceDriver, ...conformantDrivers].map((driver) => {
        const session = driver.name === referenceDriver.name
          ? refSession
          : conformantSessions[driver.name];
        return [driver.name, {
          imageDigest: session ? session.imageDigest : null,
          version: session ? session.version : null,
        }];
      })),
    };

    const resultsShards = {
      [referenceDriver.name]: referenceResults,
      ...conformantResultsByImpl,
    };

    store.writeRun({ run, resultsByImpl: resultsShards, conformerMeta, impls: orderedImpls });
    stderr(`Results written to ${resultsDir}\n`);

    writeRunSummary(stderr, {
      reference: orderedImpls[0],
      conformants: orderedImpls.slice(1),
      run,
      tests,
    });

    return { run, resultsByImpl: resultsShards, conformerMeta, impls: orderedImpls };
  } finally {
    const stopPromises = [refSession.stop()];
    for (const session of Object.values(conformantSessions)) {
      stopPromises.push(session.stop());
    }
    await Promise.allSettled(stopPromises);
  }
}

// Build a Result record in the site's Repository shape.
function buildResult({ runId, implId, testCaseId, status, expected, actual, error, stderr }) {
  const r = {
    id: resultId(runId, implId, testCaseId),
    runId,
    implId,
    testCaseId,
    status,
  };
  if (expected !== undefined) r.expected = expected;
  if (actual !== undefined) r.actual = actual;
  if (error !== undefined) r.error = error;
  if (stderr !== undefined) r.stderr = stderr;
  return r;
}

async function main(argv = process.argv.slice(2)) {
  await runConformance({ argv });
}

module.exports = {
  buildImpl,
  buildResult,
  computeCorpusFingerprint,
  parseCliArgs,
  parseConcurrency,
  readManifestFile,
  resultId,
  runConformance,
  runWithConcurrency,
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(1);
  });
}
