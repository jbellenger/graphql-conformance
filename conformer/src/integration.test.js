'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../../results');
const { discoverCorpus } = require('./corpus');
const { computeCorpusFingerprint, runConformance } = require('./index');
const { buildRequestBody } = require('./execute');

let tmpDir;
let tmpResultsDir;
let tmpRegistryPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conformer-integration-'));
  tmpResultsDir = path.join(tmpDir, 'results');
  fs.mkdirSync(tmpResultsDir);
  tmpRegistryPath = path.join(tmpDir, 'registry.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeCorpusCase(corpusDir, testId, queryId, schema, query, variables) {
  const caseDir = path.join(corpusDir, testId, queryId);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(corpusDir, testId, 'schema.graphqls'), schema);
  fs.writeFileSync(path.join(caseDir, 'query.graphql'), query);
  if (variables) {
    const varsDir = path.join(caseDir, 'vars');
    fs.mkdirSync(varsDir, { recursive: true });
    fs.writeFileSync(path.join(varsDir, 'variables.json'), JSON.stringify(variables));
  }
}

function writeStubManifest(implDir) {
  fs.mkdirSync(implDir, { recursive: true });
  fs.writeFileSync(path.join(implDir, 'manifest.json'), JSON.stringify({ name: path.basename(implDir) }));
}

function writeRegistry(drivers, reference = 'ref') {
  fs.writeFileSync(tmpRegistryPath, JSON.stringify({
    registryVersion: 1,
    reference,
    drivers: drivers.map((name) => {
      const implDir = path.join(tmpDir, name);
      writeStubManifest(implDir);
      return { name, source: 'in-tree', manifestPath: path.relative(tmpDir, path.join(implDir, 'manifest.json')) };
    }),
  }));
}

function makeSessionFactory(handlers) {
  // handlers: { name: (body) => ({ data, errors? }) | 'error' string | { error, stderr? } | Error-to-throw }
  return async (driver) => {
    const handler = handlers[driver.name];
    if (!handler) throw new Error(`no handler for driver ${driver.name}`);
    const version = handler.version || 'stub-sha-' + driver.name;
    return {
      version,
      async execute(test) {
        const body = buildRequestBody(test);
        const resp = await handler(body, test);
        return resp;
      },
      async stop() { /* noop */ },
    };
  };
}

async function runInTmp(handlers, corpusDir, argv = []) {
  const createSession = makeSessionFactory(handlers);
  const prevResults = process.env.RESULTS_DIR;
  const prevCorpus = process.env.CORPUS_DIR;
  process.env.RESULTS_DIR = tmpResultsDir;
  process.env.CORPUS_DIR = corpusDir;
  try {
    return await runConformance({
      argv: ['--registry', tmpRegistryPath, ...argv],
      createSession,
      rootDir: tmpDir,
    });
  } finally {
    if (prevResults === undefined) delete process.env.RESULTS_DIR; else process.env.RESULTS_DIR = prevResults;
    if (prevCorpus === undefined) delete process.env.CORPUS_DIR; else process.env.CORPUS_DIR = prevCorpus;
  }
}

describe('integration: self-comparison', () => {
  it('identical impls produce all true', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const handler = () => ({ result: { data: { ok: 'value' } } });
    const handlers = Object.assign((body) => handler(body), { version: 'v1' });
    await runInTmp({ ref: handler, conformant: handler }, corpusDir);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    const runResult = store.loadLatestRunSummary();
    assert.ok(runResult);
    assert.equal(runResult.reference.name, 'ref');
    const failures = store.getImplFailures('conformant');
    assert.equal(failures.length, 0);
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and reuses prior failures', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'value' } } });
    const conformantHandler = () => ({ result: { data: { ok: 'value' } } });
    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const store1 = ResultsStore.fromDirectory(tmpResultsDir);
    const run1 = store1.loadLatestRunSummary();

    // Second run: same version (stub-sha-name). Expect skip.
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);
    } finally {
      process.stderr.write = origWrite;
    }
    const stderr = stderrChunks.join('');
    assert.ok(stderr.includes('Skipping conformant (conformant)'),
      'should log that conformant was skipped');

    const store2 = ResultsStore.fromDirectory(tmpResultsDir);
    const runs = store2.listRuns();
    assert.equal(runs.length, 2);
    const run2 = store2.loadLatestRun();
    assert.deepStrictEqual(
      run2.conformants.conformant.failuresByTestKey,
      run1.conformants.conformant.failuresByTestKey,
    );
  });

  it('reuses failure-only skipped results without re-running', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const discoveredTests = discoverCorpus(corpusDir);
    const corpusTotal = discoveredTests.length;
    const corpusFingerprint = computeCorpusFingerprint(discoveredTests);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'prior-run',
      timestamp: '2026-03-18T00:00:00.000Z',
      reference: {
        name: 'ref',
        sha: 'stub-sha-ref',
        scoringModel: 'runnable-set-v1',
        total: corpusTotal,
        errors: 0,
        corpusTotal,
        corpusFingerprint,
        excluded: 0,
      },
      conformants: {
        conformant: {
          sha: 'stub-sha-conformant',
          total: corpusTotal,
          passed: 0,
          failuresByTestKey: {
            'ok-test/ok-query': { testKey: 'ok-test/ok-query', error: 'seeded mismatch' },
          },
        },
      },
    });

    const handler = () => ({ result: { data: { ok: 'value' } } });
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      await runInTmp({ ref: handler, conformant: handler }, corpusDir);
    } finally {
      process.stderr.write = origWrite;
    }

    assert.match(stderrChunks.join(''), /Skipping conformant \(conformant\)/);

    const latestRun = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(latestRun.conformants.conformant.total, corpusTotal);
    assert.equal(latestRun.conformants.conformant.passed, 0);
    assert.deepStrictEqual(
      Object.keys(latestRun.conformants.conformant.failuresByTestKey),
      ['ok-test/ok-query'],
    );
  });
});

describe('integration: --force flag', () => {
  it('re-runs all conformants even when unchanged', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    let conformantRuns = 0;
    const refHandler = () => ({ result: { data: { ok: 'value' } } });
    const conformantHandler = () => { conformantRuns += 1; return { result: { data: { ok: 'value' } } }; };

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);
    const runsAfterFirst = conformantRuns;

    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir, ['--force']);
    } finally {
      process.stderr.write = origWrite;
    }
    const stderr = stderrChunks.join('');
    assert.match(stderr, /Force flag set/);
    assert.ok(!stderr.includes('Skipping conformant'),
      'conformant must not be skipped when --force is set');
    assert.ok(conformantRuns > runsAfterFirst, 'conformant should have actually run again');
  });
});

describe('integration: corpus change invalidates skip', () => {
  it('re-runs all conformants when the corpus grows', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    let conformantRuns = 0;
    const refHandler = () => ({ result: { data: { ok: 'value' } } });
    const conformantHandler = () => { conformantRuns += 1; return { result: { data: { ok: 'value' } } }; };

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const run1 = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.ok(run1.reference.corpusFingerprint);
    assert.equal(run1.conformants.conformant.total, 1);
    const runsAfterFirst = conformantRuns;

    // Grow the corpus
    writeCorpusCase(corpusDir, 'ok-test-2', 'ok-query', 'type Query { ok: String }', '{ ok }');

    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);
    } finally {
      process.stderr.write = origWrite;
    }
    const stderr = stderrChunks.join('');
    assert.match(stderr, /Corpus changed since prior run/);
    assert.ok(!stderr.includes('Skipping conformant'),
      'conformant must not be skipped when corpus changed');
    assert.ok(conformantRuns > runsAfterFirst, 'conformant should have actually run');

    const run2 = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(run2.conformants.conformant.total, 2);
    assert.notEqual(run2.reference.corpusFingerprint, run1.reference.corpusFingerprint);
  });
});

describe('integration: object-ordering quirk', () => {
  it('marks a conformant with different key order as matching with quirk', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ordering-test', 'ordering-query',
      'type Query { a: String b: String }', '{ a b }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { a: 'x', b: 'y' } } });
    const conformantHandler = () => ({ result: { data: { b: 'y', a: 'x' } } });

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const run = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(run.conformants.conformant.passed, 1);
    assert.deepStrictEqual(
      run.conformants.conformant.quirksByTestKey,
      { 'ordering-test/ordering-query': ['object-ordering'] },
    );
  });
});

describe('integration: reference exclusions', () => {
  it('excludes reference-crash cases and does not run conformants for them', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeCorpusCase(corpusDir, 'excluded-test', 'excluded-query', 'type Query { boom: String }', '{ boom }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = (body) => {
      if (body.query.includes('boom')) return { error: 'reference exploded', stderr: 'boom!' };
      return { result: { data: { ok: 'value' } } };
    };
    let conformantCalls = 0;
    const conformantHandler = () => { conformantCalls += 1; return { result: { data: { ok: 'value' } } }; };

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    const run = store.loadLatestRunSummary();

    assert.equal(run.reference.total, 1);
    assert.equal(run.reference.excluded, 1);
    assert.equal(run.reference.corpusTotal, 2);
    assert.equal(run.reference.exclusions.length, 1);
    assert.equal(run.reference.exclusions[0].testKey, 'excluded-test/excluded-query');

    const conformant = run.conformants.conformant;
    assert.equal(conformant.total, 1);
    assert.equal(conformant.passed, 1);
    assert.deepStrictEqual(Object.keys(conformant.failuresByTestKey), []);

    assert.equal(conformantCalls, 1, 'conformant should only run for the non-excluded test');
  });

  it('reuses prior reference exclusions when all conformants are skipped', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeCorpusCase(corpusDir, 'excluded-test', 'excluded-query', 'type Query { boom: String }', '{ boom }');
    writeRegistry(['ref', 'conformant']);

    const discoveredTests = discoverCorpus(corpusDir);
    const corpusFingerprint = computeCorpusFingerprint(discoveredTests);

    ResultsStore.fromDirectory(tmpResultsDir).recordRun({
      id: 'prior-run',
      timestamp: '2026-03-18T00:00:00.000Z',
      reference: {
        name: 'ref',
        sha: 'stub-sha-ref',
        scoringModel: 'runnable-set-v1',
        total: 1,
        errors: 0,
        corpusTotal: 2,
        corpusFingerprint,
        excluded: 1,
        exclusions: [{ testKey: 'excluded-test/excluded-query', error: 'reference exploded' }],
      },
      conformants: {
        conformant: {
          sha: 'stub-sha-conformant',
          total: 1,
          passed: 1,
        },
      },
    });

    let refCalls = 0;
    let conformantCalls = 0;
    const refHandler = () => { refCalls += 1; return { result: { data: { ok: 'value' } } }; };
    const conformantHandler = () => { conformantCalls += 1; return { result: { data: { ok: 'value' } } }; };

    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    try {
      await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);
    } finally {
      process.stderr.write = origWrite;
    }
    assert.match(stderrChunks.join(''), /All conformants unchanged, skipping test execution/);

    const latestRun = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(latestRun.reference.total, 1);
    assert.equal(latestRun.reference.excluded, 1);
    assert.equal(latestRun.reference.exclusions.length, 1);
    assert.equal(latestRun.reference.exclusions[0].testKey, 'excluded-test/excluded-query');

    assert.equal(refCalls, 0, 'reference should not run when reusing prior reference exclusions');
    assert.equal(conformantCalls, 0, 'conformant should not run when skipped');
  });
});
