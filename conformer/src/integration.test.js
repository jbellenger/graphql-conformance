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
    drivers: drivers.map((driver) => {
      const entry = typeof driver === 'string' ? { name: driver } : driver;
      const { name } = entry;
      const implDir = path.join(tmpDir, name);
      writeStubManifest(implDir);
      return {
        ...entry,
        name,
        source: entry.source || 'in-tree',
        manifestPath: entry.manifestPath || path.relative(tmpDir, path.join(implDir, 'manifest.json')),
      };
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
    assert.equal(latest.run.excluded, 0);
    assert.equal(latest.run.resultsByImpl.ref.total, 1);
    assert.equal(latest.run.resultsByImpl.ref.passed, 1);
    assert.equal(latest.run.resultsByImpl.conformant.total, 1);
    assert.equal(latest.run.resultsByImpl.conformant.passed, 1);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 0);
    assert.equal(latest.run.resultsByImpl.conformant.errored, 0);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, null);
    assert.deepStrictEqual(latest.resultsByImpl.conformant, []);
  });
});

describe('integration: disabled registry drivers', () => {
  it('skips disabled conformants by default', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', 'enabled', { name: 'disabled', enabled: false }]);

    const handler = () => ({ result: { data: { ok: 'value' } } });
    await runInTmp({ ref: handler, enabled: handler }, corpusDir);

    const latest = loadLatest();
    assert.deepStrictEqual(latest.run.implIds, ['ref', 'enabled']);
    assert.ok(!latest.run.resultsByImpl.disabled);
  });

  it('runs a disabled conformant when explicitly requested', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeCorpusCase(corpusDir, 'ok-test', 'ok-query', 'type Query { ok: String }', '{ ok }');
    writeRegistry(['ref', { name: 'disabled', enabled: false }]);

    const handler = () => ({ result: { data: { ok: 'value' } } });
    await runInTmp({ ref: handler, disabled: handler }, corpusDir, ['--drivers', 'disabled']);

    const latest = loadLatest();
    assert.deepStrictEqual(latest.run.implIds, ['ref', 'disabled']);
    assert.equal(latest.run.resultsByImpl.disabled.total, 1);
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
        excluded: 0,
        resultsByImpl: {
          ref: {
            implId: 'ref', total: 1, passed: 1, failed: 0, errored: 0, falloutAfter: null, results: [],
          },
          conformant: {
            implId: 'conformant', total: 1, passed: 0, failed: 1, errored: 0, falloutAfter: null, results: [],
          },
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
    assert.equal(run1.run.resultsByImpl.ref.total, 1);
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
    assert.equal(run2.run.resultsByImpl.ref.total, 2);
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
    assert.equal(latest.run.resultsByImpl.ref.total, 2);
    assert.equal(latest.run.excluded, 1);
    assert.equal(latest.run.resultsByImpl.ref.passed, 1);
    assert.equal(latest.run.resultsByImpl.conformant.total, 1);
    assert.equal(latest.run.resultsByImpl.conformant.passed, 1);
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
    assert.equal(latest.run.excluded, 1);
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
    assert.equal(latest.run.resultsByImpl.ref.total, 1);
    assert.equal(latest.run.excluded, 1);
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
    assert.equal(latest.run.excluded, 0);
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
        excluded: 1,
        resultsByImpl: {
          ref: {
            implId: 'ref', total: 2, passed: 1, failed: 0, errored: 0, falloutAfter: null, results: [],
          },
          conformant: {
            implId: 'conformant', total: 1, passed: 1, failed: 0, errored: 0, falloutAfter: null, results: [],
          },
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
    assert.equal(latest.run.resultsByImpl.ref.total, 2);
    assert.equal(latest.run.excluded, 1);
    const refExcludedResult = latest.resultsByImpl.ref.find((r) => r.status === 'excluded');
    assert.equal(refExcludedResult.testCaseId, 'excluded-test/excluded-query');

    assert.equal(refCalls, 0, 'reference should not run when reusing prior reference exclusions');
    assert.equal(conformantCalls, 0, 'conformant should not run when skipped');
  });
});

describe('integration: graduated testing', () => {
  // Build an N-test corpus sharing one schema so each case triggers the
  // per-test fallout check independently.
  function writeNCaseCorpus(corpusDir, n) {
    for (let i = 0; i < n; i += 1) {
      writeCorpusCase(
        corpusDir,
        `test-${String(i).padStart(3, '0')}`,
        'q',
        'type Query { ok: String }',
        '{ ok }',
      );
    }
  }

  it('without the flag, every conformant sees the full corpus (legacy behavior)', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 5);
    writeRegistry(['ref', 'conformant']);

    // Conformant always differs → would fall out if a threshold were set.
    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    const conformantHandler = () => ({ result: { data: { ok: 'other' } } });

    await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.total, 5);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 5);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, null);
    assert.equal(latest.resultsByImpl.conformant.length, 5);
  });

  it('under threshold: no fallout, full run, falloutAfter is null', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 5);
    writeRegistry(['ref', 'conformant']);

    // 2 non-passes < threshold=3 → conformant runs to completion.
    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    let call = 0;
    const conformantHandler = () => {
      call += 1;
      if (call <= 2) return { result: { data: { ok: 'differs' } } };
      return { result: { data: { ok: 'ref-value' } } };
    };

    await runInTmp(
      { ref: refHandler, conformant: conformantHandler },
      corpusDir,
      ['--max-impl-failures', '3'],
    );

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.total, 5, 'should have seen the full corpus');
    assert.equal(latest.run.resultsByImpl.conformant.failed, 2);
    assert.equal(latest.run.resultsByImpl.conformant.passed, 3);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, null);
  });

  it('threshold reached: fallout fires, session stopped, partial results preserved', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 10);
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    let conformantCalls = 0;
    let conformantStops = 0;
    // Conformant always fails; with threshold=2, fallout triggers at the
    // 2nd non-pass (failed+errored >= 2) → total=2, failed=2, then stop.
    const createSession = async (driver) => {
      if (driver.name === 'ref') {
        return {
          version: null,
          imageDigest: 'stub-image-ref',
          async execute() { return refHandler(); },
          async stop() { /* noop */ },
        };
      }
      return {
        version: null,
        imageDigest: 'stub-image-conformant',
        async execute() {
          conformantCalls += 1;
          return { result: { data: { ok: 'differs' } } };
        },
        async stop() { conformantStops += 1; },
      };
    };

    await runWithCustomSession(createSession, corpusDir, ['--max-impl-failures', '2']);

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.total, 2,
      'conformant should have seen exactly 2 tests before fallout (failed=2 >= threshold=2)');
    assert.equal(latest.run.resultsByImpl.conformant.failed, 2);
    assert.equal(latest.run.resultsByImpl.conformant.errored, 0);
    assert.equal(latest.run.resultsByImpl.conformant.passed, 0);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, 2);

    // Reference still sees the full corpus; its total stays at 10.
    assert.equal(latest.run.resultsByImpl.ref.total, 10);

    // Per-impl shard has the 2 recorded failures.
    assert.equal(latest.resultsByImpl.conformant.length, 2);

    // Eager session stop (called at fallout; final cleanup is best-effort).
    assert.ok(conformantStops >= 1, 'conformant session.stop() should have been called on fallout');
    assert.equal(conformantCalls, 2, 'conformant should not be invoked after fallout');
  });

  it('counts errors toward the fallout threshold, not just mismatches', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 10);
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    const conformantHandler = () => ({ error: 'timeout', stderr: 'no response' });

    await runInTmp(
      { ref: refHandler, conformant: conformantHandler },
      corpusDir,
      ['--max-impl-failures', '1'],
    );

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.total, 1,
      'threshold=1: 1st error trips fallout (errored >= 1)');
    assert.equal(latest.run.resultsByImpl.conformant.errored, 1);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 0);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, 1);
  });

  it('when all conformants fall out, the loop terminates early', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 20);
    writeRegistry(['ref', 'c1', 'c2']);

    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    let refCalls = 0;
    const countedRef = () => { refCalls += 1; return refHandler(); };
    const c1Handler = () => ({ result: { data: { ok: 'differs-a' } } });
    const c2Handler = () => ({ result: { data: { ok: 'differs-b' } } });

    await runInTmp(
      { ref: countedRef, c1: c1Handler, c2: c2Handler },
      corpusDir,
      ['--max-impl-failures', '1'],
    );

    const latest = loadLatest();
    // Both conformants fall out after 1 non-pass (threshold=1, fallout at >=).
    assert.equal(latest.run.resultsByImpl.c1.falloutAfter, 1);
    assert.equal(latest.run.resultsByImpl.c2.falloutAfter, 1);
    // Reference should not have been called for every test in the corpus,
    // since the loop terminates once both conformants are out.
    assert.ok(refCalls < 20, `reference should stop early; got ${refCalls} calls out of 20`);
    assert.ok(refCalls >= 1, 'reference must have run for at least the test that caused fallout');
  });

  it('reference is not subject to fallout even with many exclusions', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    // Two valid tests and three that the reference cannot compute.
    writeCorpusCase(corpusDir, 'ok-1', 'q', 'type Query { ok: String }', '{ ok }');
    writeCorpusCase(corpusDir, 'ok-2', 'q', 'type Query { ok: String }', '{ ok }');
    writeCorpusCase(corpusDir, 'bad-1', 'q', 'type Query { boom: String }', '{ boom }');
    writeCorpusCase(corpusDir, 'bad-2', 'q', 'type Query { boom: String }', '{ boom }');
    writeCorpusCase(corpusDir, 'bad-3', 'q', 'type Query { boom: String }', '{ boom }');
    writeRegistry(['ref', 'conformant']);

    const refHandler = (body) => {
      if (body.query.includes('boom')) return { error: 'ref exploded' };
      return { result: { data: { ok: 'ref-value' } } };
    };
    const conformantHandler = () => ({ result: { data: { ok: 'ref-value' } } });

    // threshold=1 would trip a conformant after 1 failure, but the reference
    // should never be dropped even though its "excluded" count (3) exceeds it.
    await runInTmp(
      { ref: refHandler, conformant: conformantHandler },
      corpusDir,
      ['--max-impl-failures', '1'],
    );

    const latest = loadLatest();
    assert.equal(latest.run.excluded, 3, 'reference should record all 3 exclusions');
    assert.equal(latest.run.resultsByImpl.ref.total, 5, 'reference should see the full corpus');
    assert.equal(latest.run.resultsByImpl.conformant.total, 2, 'conformant only sees non-excluded');
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, null);
  });

  it('preserves prior-run falloutAfter when skipping unchanged conformants', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 1);
    writeRegistry(['ref', 'conformant']);

    const discoveredTests = discoverCorpus(corpusDir);
    const corpusFingerprint = computeCorpusFingerprint(discoveredTests);

    // Seed a prior run where the conformant fell out at 7 tests.
    const priorRunId = 'prior-fallout';
    ResultsStore.fromDirectory(tmpResultsDir).writeRun({
      run: {
        id: priorRunId,
        timestamp: '2026-03-18T00:00:00.000Z',
        referenceImplId: 'ref',
        implIds: ['ref', 'conformant'],
        excluded: 0,
        resultsByImpl: {
          ref: {
            implId: 'ref', total: 1, passed: 1, failed: 0, errored: 0, falloutAfter: null, results: [],
          },
          conformant: {
            implId: 'conformant', total: 7, passed: 2, failed: 5, errored: 0,
            falloutAfter: 7, results: [],
          },
        },
      },
      resultsByImpl: { ref: [], conformant: [] },
      conformerMeta: {
        corpusFingerprint,
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

    // Unchanged image digest → conformant should be skipped; prior bucket
    // (including falloutAfter=7) should carry forward.
    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    const conformantHandler = () => ({ result: { data: { ok: 'ref-value' } } });

    await runInTmp(
      { ref: refHandler, conformant: conformantHandler },
      corpusDir,
    );

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, 7);
    assert.equal(latest.run.resultsByImpl.conformant.total, 7);
    assert.equal(latest.run.resultsByImpl.conformant.passed, 2);
  });

  it('threshold=0 or missing disables fallout entirely', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 4);
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    const conformantHandler = () => ({ result: { data: { ok: 'differs' } } });

    await runInTmp(
      { ref: refHandler, conformant: conformantHandler },
      corpusDir,
      ['--max-impl-failures', '0'],
    );

    const latest = loadLatest();
    // With threshold parsed as null (≤0), the conformant runs every test.
    assert.equal(latest.run.resultsByImpl.conformant.total, 4);
    assert.equal(latest.run.resultsByImpl.conformant.failed, 4);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, null);
  });

  it('CONFORMER_MAX_IMPL_FAILURES env var drives fallout when CLI is unset', async () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    writeNCaseCorpus(corpusDir, 10);
    writeRegistry(['ref', 'conformant']);

    const refHandler = () => ({ result: { data: { ok: 'ref-value' } } });
    const conformantHandler = () => ({ result: { data: { ok: 'differs' } } });

    const prev = process.env.CONFORMER_MAX_IMPL_FAILURES;
    process.env.CONFORMER_MAX_IMPL_FAILURES = '3';
    try {
      await runInTmp({ ref: refHandler, conformant: conformantHandler }, corpusDir);
    } finally {
      if (prev === undefined) delete process.env.CONFORMER_MAX_IMPL_FAILURES;
      else process.env.CONFORMER_MAX_IMPL_FAILURES = prev;
    }

    const latest = loadLatest();
    assert.equal(latest.run.resultsByImpl.conformant.total, 3,
      'env threshold=3: 3rd non-pass trips fallout (failed >= 3)');
    assert.equal(latest.run.resultsByImpl.conformant.failed, 3);
    assert.equal(latest.run.resultsByImpl.conformant.falloutAfter, 3);
  });
});
