'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../../results');
const { discoverCorpus } = require('./corpus');
const { computeCorpusFingerprint, runConformance, resultId } = require('./index');
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
  return async (driver) => {
    const handler = handlers[driver.name];
    if (!handler) throw new Error(`no handler for driver ${driver.name}`);
    const version = handler.version !== undefined ? handler.version : null;
    const imageDigest = handler.imageDigest || `stub-image-${driver.name}`;
    return {
      version,
      imageDigest,
      async execute(test) {
        const body = buildRequestBody(test);
        return handler(body, test);
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

async function runWithCustomSession(createSession, corpusDir, argv = []) {
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

function loadLatest() {
  return ResultsStore.fromDirectory(tmpResultsDir).loadLatestRun();
}

describe('integration: parallel session startup', () => {
  it('respects CONFORMER_CONCURRENCY when starting conformants', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);

    let active = 0;
    let peak = 0;
    const createSession = async (driver) => {
      if (driver.name !== 'ref') {
        active += 1;
        if (active > peak) peak = active;
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
      }
      return {
        version: null,
        imageDigest: `digest-${driver.name}`,
        async execute() { return { result: { data: { ok: 'value' } } }; },
        async stop() { /* noop */ },
      };
    };

    const prev = process.env.CONFORMER_CONCURRENCY;
    process.env.CONFORMER_CONCURRENCY = '3';
    try {
      await runWithCustomSession(createSession, corpusDir);
    } finally {
      if (prev === undefined) delete process.env.CONFORMER_CONCURRENCY;
      else process.env.CONFORMER_CONCURRENCY = prev;
    }

    assert.equal(peak, 3, 'should cap concurrent conformant startups at 3');
  });

  it('falls back to full parallelism when CONFORMER_CONCURRENCY is unset', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'c1', 'c2', 'c3', 'c4']);

    let active = 0;
    let peak = 0;
    const createSession = async (driver) => {
      if (driver.name !== 'ref') {
        active += 1;
        if (active > peak) peak = active;
        await new Promise((r) => setTimeout(r, 15));
        active -= 1;
      }
      return {
        version: null,
        imageDigest: `digest-${driver.name}`,
        async execute() { return { result: { data: { ok: 'value' } } }; },
        async stop() { /* noop */ },
      };
    };

    const prev = process.env.CONFORMER_CONCURRENCY;
    delete process.env.CONFORMER_CONCURRENCY;
    try {
      await runWithCustomSession(createSession, corpusDir);
    } finally {
      if (prev !== undefined) process.env.CONFORMER_CONCURRENCY = prev;
    }

    assert.equal(peak, 4, 'should run all 4 conformants in parallel when limit is unset');
  });

  it('surfaces a startup failure after other sessions have been awaited', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'good-a', 'bad', 'good-b']);

    const stops = [];
    const createSession = async (driver) => {
      if (driver.name === 'bad') {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('ignition failed');
      }
      return {
        version: null,
        imageDigest: `digest-${driver.name}`,
        async execute() { return { result: { data: { ok: 'value' } } }; },
        async stop() { stops.push(driver.name); },
      };
    };

    await assert.rejects(
      runWithCustomSession(createSession, corpusDir),
      /bad.*ignition failed/s,
    );
    assert.ok(stops.includes('ref'), 'reference session must be stopped on failure');
    assert.ok(stops.includes('good-a'), 'good-a must be stopped on failure');
    assert.ok(stops.includes('good-b'), 'good-b must be stopped on failure');
  });
});

describe('integration: self-comparison', () => {
  it('identical impls produce zero non-pass results', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const handler = () => ({ result: { data: { ok: 'value' } } });
    await runInTmp({ ref: handler, conformant: handler }, corpusDir);

    const latest = loadLatest();
    assert.ok(latest);
    assert.equal(latest.run.referenceImplId, 'ref');
    assert.equal(latest.run.testCaseCount, 1);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 0);
    assert.equal(latest.run.resultsByImpl.conformant.errored, 0);
    assert.deepStrictEqual(latest.resultsByImpl.conformant, []);
  });
});

describe('integration: conformant driver error', () => {
  it('classifies driver-error responses as status "error", not "fail"', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'crasher', 'differs']);

    const refHandler = () => ({ result: { data: { ok: 'value' } } });
    const crasherHandler = () => ({ error: 'timeout', stderr: 'no response from driver' });
    const differsHandler = () => ({ result: { data: { ok: 'other' } } });

    await runInTmp(
      { ref: refHandler, crasher: crasherHandler, differs: differsHandler },
      corpusDir,
    );

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.crasher.errored, 1);
    assert.equal(latest.run.resultsByImpl.crasher.failed, 0);
    assert.equal(latest.run.resultsByImpl.differs.failed, 1);
    assert.equal(latest.run.resultsByImpl.differs.errored, 0);

    const crasherResult = latest.resultsByImpl.crasher[0];
    assert.equal(crasherResult.status, 'error');
    assert.equal(crasherResult.error, 'timeout');
    assert.equal(crasherResult.stderr, 'no response from driver');

    const differsResult = latest.resultsByImpl.differs[0];
    assert.equal(differsResult.status, 'fail');
    assert.deepStrictEqual(differsResult.expected, { data: { ok: 'value' } });
    assert.deepStrictEqual(differsResult.actual, { data: { ok: 'other' } });
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and reuses prior non-pass results', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'value' } } });
    const conformantHandler = () => ({ result: { data: { ok: 'differs' } } });
    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const first = loadLatest();
    assert.equal(first.resultsByImpl.conformant.length, 1);
    const firstFailureTestCaseId = first.resultsByImpl.conformant[0].testCaseId;

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

    const runsIdx = ResultsStore.fromDirectory(tmpResultsDir).listRuns();
    assert.equal(runsIdx.length, 2);

    const second = loadLatest();
    assert.equal(second.resultsByImpl.conformant.length, 1);
    assert.equal(second.resultsByImpl.conformant[0].testCaseId, firstFailureTestCaseId);
    assert.equal(second.resultsByImpl.conformant[0].runId, second.run.id);
  });

  it('reuses failure-only skipped results without re-running', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const discoveredTests = discoverCorpus(corpusDir);
    const corpusFingerprint = computeCorpusFingerprint(discoveredTests);

    const priorRunId = 'prior-run';
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.writeRun({
      run: {
        id: priorRunId,
        timestamp: '2026-03-18T00:00:00.000Z',
        referenceImplId: 'ref',
        implIds: ['ref', 'conformant'],
        testCaseCount: 1,
        resultsByImpl: {
          ref: { implId: 'ref', failed: 0, excluded: 0, errored: 0, results: [] },
          conformant: { implId: 'conformant', failed: 1, excluded: 0, errored: 0, results: [] },
        },
      },
      resultsByImpl: {
        ref: [],
        conformant: [{
          id: resultId(priorRunId, 'conformant', 'ok-test/ok-query'),
          runId: priorRunId,
          implId: 'conformant',
          testCaseId: 'ok-test/ok-query',
          status: 'fail',
          error: 'seeded mismatch',
        }],
      },
      conformerMeta: {
        corpusFingerprint,
        scoringModel: 'runnable-set-v1',
        runnableCount: 1,
        implMeta: {
          ref: { imageDigest: 'stub-image-ref', version: null },
          conformant: { imageDigest: 'stub-image-conformant', version: null },
        },
      },
      impls: [
        { id: 'ref', name: 'ref', language: 'unknown' },
        { id: 'conformant', name: 'conformant', language: 'unknown' },
      ],
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

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.failed, 1);
    assert.deepStrictEqual(
      latest.resultsByImpl.conformant.map((r) => r.testCaseId),
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

    const run1 = loadLatest();
    assert.ok(run1.conformerMeta.corpusFingerprint);
    assert.equal(run1.run.testCaseCount, 1);
    const runsAfterFirst = conformantRuns;

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

    const run2 = loadLatest();
    assert.equal(run2.run.testCaseCount, 2);
    assert.notEqual(run2.conformerMeta.corpusFingerprint, run1.conformerMeta.corpusFingerprint);
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

    const latest = loadLatest();
    assert.equal(latest.run.testCaseCount, 2);
    assert.equal(latest.run.resultsByImpl.ref.excluded, 1);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 0);

    const refResults = latest.resultsByImpl.ref;
    const excluded = refResults.filter((r) => r.status === 'excluded');
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].testCaseId, 'excluded-test/excluded-query');
    assert.equal(excluded[0].error, 'reference exploded');

    assert.equal(conformantCalls, 1, 'conformant should only run for the non-excluded test');
  });

  it('excludes tests where the reference returns GraphQL errors', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeCorpusCase(corpusDir, 'err-test', 'err-query', 'type Query { bad: String }', '{ bad }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = (body) => {
      if (body.query.includes('bad')) {
        return {
          result: {
            errors: [{ message: 'validation failed: bad field', locations: [{ line: 1, column: 3 }] }],
          },
          status: 200,
        };
      }
      return { result: { data: { ok: 'value' } } };
    };
    let conformantCalls = 0;
    const conformantHandler = (body) => {
      conformantCalls += 1;
      if (body.query.includes('bad')) return { result: { data: { bad: 'str' } } };
      return { result: { data: { ok: 'value' } } };
    };

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.ref.excluded, 1);
    const refExcludedResult = latest.resultsByImpl.ref.find((r) => r.status === 'excluded');
    assert.equal(refExcludedResult.testCaseId, 'err-test/err-query');
    assert.equal(refExcludedResult.error, undefined);
    assert.ok(Array.isArray(refExcludedResult.actual.errors));
    assert.equal(refExcludedResult.actual.errors[0].message, 'validation failed: bad field');

    assert.equal(latest.run.resultsByImpl.conformant.failed, 0);
    assert.equal(conformantCalls, 1, 'conformant should only run for the non-excluded test');
  });

  it('excludes tests where the reference returns errors alongside data', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'partial-test', 'partial-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({
      result: {
        data: { ok: null },
        errors: [{ message: 'resolver failed', path: ['ok'] }],
      },
      status: 200,
    });
    let conformantCalls = 0;
    const conformantHandler = () => {
      conformantCalls += 1;
      return { result: { data: { ok: 'value' } } };
    };

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const latest = loadLatest();
    assert.equal(latest.run.testCaseCount, 1);
    assert.equal(latest.run.resultsByImpl.ref.excluded, 1);
    const refExcludedResult = latest.resultsByImpl.ref.find((r) => r.status === 'excluded');
    assert.equal(refExcludedResult.testCaseId, 'partial-test/partial-query');
    assert.deepStrictEqual(refExcludedResult.actual.data, { ok: null });
    assert.equal(refExcludedResult.actual.errors[0].message, 'resolver failed');

    assert.equal(conformantCalls, 0, 'conformant should not run when reference produced errors');
  });

  it('does not exclude when the reference returns an empty errors array', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'value' }, errors: [] } });
    const conformantHandler = () => ({ result: { data: { ok: 'value' }, errors: [] } });

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.ref.excluded, 0);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 0);
  });

  it('reuses prior reference exclusions when all conformants are skipped', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeCorpusCase(corpusDir, 'excluded-test', 'excluded-query', 'type Query { boom: String }', '{ boom }');
    writeRegistry(['ref', 'conformant']);

    const discoveredTests = discoverCorpus(corpusDir);
    const corpusFingerprint = computeCorpusFingerprint(discoveredTests);

    const priorRunId = 'prior-run';
    ResultsStore.fromDirectory(tmpResultsDir).writeRun({
      run: {
        id: priorRunId,
        timestamp: '2026-03-18T00:00:00.000Z',
        referenceImplId: 'ref',
        implIds: ['ref', 'conformant'],
        testCaseCount: 2,
        resultsByImpl: {
          ref: { implId: 'ref', failed: 0, excluded: 1, errored: 0, results: [] },
          conformant: { implId: 'conformant', failed: 0, excluded: 0, errored: 0, results: [] },
        },
      },
      resultsByImpl: {
        ref: [{
          id: resultId(priorRunId, 'ref', 'excluded-test/excluded-query'),
          runId: priorRunId,
          implId: 'ref',
          testCaseId: 'excluded-test/excluded-query',
          status: 'excluded',
          error: 'reference exploded',
        }],
        conformant: [],
      },
      conformerMeta: {
        corpusFingerprint,
        scoringModel: 'runnable-set-v1',
        runnableCount: 1,
        implMeta: {
          ref: { imageDigest: 'stub-image-ref', version: null },
          conformant: { imageDigest: 'stub-image-conformant', version: null },
        },
      },
      impls: [
        { id: 'ref', name: 'ref', language: 'unknown' },
        { id: 'conformant', name: 'conformant', language: 'unknown' },
      ],
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

    const latest = loadLatest();
    assert.equal(latest.run.testCaseCount, 2);
    assert.equal(latest.run.resultsByImpl.ref.excluded, 1);
    const refExcludedResult = latest.resultsByImpl.ref.find((r) => r.status === 'excluded');
    assert.equal(refExcludedResult.testCaseId, 'excluded-test/excluded-query');

    assert.equal(refCalls, 0, 'reference should not run when reusing prior reference exclusions');
    assert.equal(conformantCalls, 0, 'conformant should not run when skipped');
  });
});
