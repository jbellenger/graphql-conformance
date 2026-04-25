'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('./index');

function bucket(implId, overrides = {}) {
  return {
    implId,
    total: overrides.total ?? 0,
    passed: overrides.passed ?? 0,
    failed: overrides.failed ?? 0,
    errored: overrides.errored ?? 0,
    falloutAfter: overrides.falloutAfter ?? null,
    results: [],
  };
}

function makeRun(overrides = {}) {
  const id = overrides.id || '2026-03-17T22-42-11Z';
  return {
    id,
    timestamp: overrides.timestamp || '2026-03-17T22:42:11.609Z',
    referenceImplId: overrides.referenceImplId || 'graphql-js',
    implIds: overrides.implIds || ['graphql-js', 'graphql-java'],
    excluded: overrides.excluded ?? 0,
    resultsByImpl: overrides.resultsByImpl || {
      'graphql-js': bucket('graphql-js', { total: 3, passed: 3 }),
      'graphql-java': bucket('graphql-java', { total: 3, passed: 2, failed: 1 }),
    },
  };
}

function makeImpls() {
  return [
    { id: 'graphql-js', name: 'graphql-js', language: 'JavaScript', version: 'abc' },
    { id: 'graphql-java', name: 'graphql-java', language: 'Java', version: 'def' },
  ];
}

function makeMeta(overrides = {}) {
  return {
    corpusFingerprint: overrides.corpusFingerprint || 'fingerprint-1',
    implMeta: overrides.implMeta || {
      'graphql-js': { imageDigest: 'sha256:ref-digest', version: 'abc' },
      'graphql-java': { imageDigest: 'sha256:java-digest', version: 'def' },
    },
  };
}

describe('ResultsStore', () => {
  describe('writeRun + loadLatestRun', () => {
    it('round-trips a run through memory', () => {
      const store = ResultsStore.inMemory();
      const run = makeRun();
      const resultsByImpl = {
        'graphql-js': [],
        'graphql-java': [
          {
            id: 'r1', runId: run.id, implId: 'graphql-java',
            testCaseId: 'a/b/c', status: 'fail',
            expected: { data: { x: 1 } }, actual: { data: { x: 2 } },
          },
        ],
      };
      store.writeRun({ run, resultsByImpl, conformerMeta: makeMeta(), impls: makeImpls() });

      const latest = store.loadLatestRun();
      assert.ok(latest);
      assert.equal(latest.run.id, run.id);
      assert.equal(latest.run.excluded, 0);
      assert.equal(latest.run.resultsByImpl['graphql-js'].total, 3);
      assert.equal(latest.run.resultsByImpl['graphql-java'].failed, 1);
      assert.deepStrictEqual(latest.resultsByImpl['graphql-java'][0].testCaseId, 'a/b/c');
      assert.equal(latest.conformerMeta.corpusFingerprint, 'fingerprint-1');
    });

    it('keeps runs sorted newest first', () => {
      const store = ResultsStore.inMemory();
      store.writeRun({
        run: makeRun({ id: 'run-old', timestamp: '2026-03-15T00:00:00Z' }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });
      store.writeRun({
        run: makeRun({ id: 'run-new', timestamp: '2026-03-16T00:00:00Z' }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });

      const runs = store.listRuns();
      assert.equal(runs.length, 2);
      assert.equal(runs[0].id, 'run-new');
      assert.equal(runs[1].id, 'run-old');
    });

    it('returns null loadLatestRun when empty', () => {
      assert.equal(ResultsStore.inMemory().loadLatestRun(), null);
    });
  });

  describe('impls.json', () => {
    it('is written verbatim', () => {
      const store = ResultsStore.inMemory();
      const impls = makeImpls();
      store.writeRun({
        run: makeRun(), resultsByImpl: {}, conformerMeta: makeMeta(), impls,
      });
      assert.deepStrictEqual(store._data.get('impls'), impls);
    });
  });

  describe('impl history', () => {
    it('accumulates history points across runs in newest-first order', () => {
      const store = ResultsStore.inMemory();
      store.writeRun({
        run: makeRun({ id: 'r1', timestamp: '2026-03-15T00:00:00Z' }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });
      store.writeRun({
        run: makeRun({
          id: 'r2',
          timestamp: '2026-03-16T00:00:00Z',
          excluded: 1,
          resultsByImpl: {
            'graphql-js': bucket('graphql-js', { total: 3, passed: 2 }),
            'graphql-java': bucket('graphql-java', { total: 2, passed: 2 }),
          },
        }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });

      const history = store._data.get('impls/graphql-java/history');
      assert.equal(history.length, 2);
      assert.equal(history[0].runId, 'r2');
      assert.equal(history[0].total, 2);
      assert.equal(history[0].passed, 2);
      assert.equal(history[0].failed, 0);
      assert.equal(history[0].falloutAfter, null);
      assert.equal(history[1].runId, 'r1');
      assert.equal(history[1].failed, 1);
    });

    it('propagates falloutAfter from the per-run bucket', () => {
      const store = ResultsStore.inMemory();
      store.writeRun({
        run: makeRun({
          id: 'rfo',
          timestamp: '2026-04-01T00:00:00Z',
          resultsByImpl: {
            'graphql-js': bucket('graphql-js', { total: 3, passed: 3 }),
            'graphql-java': bucket('graphql-java', {
              total: 2, passed: 0, failed: 2, falloutAfter: 2,
            }),
          },
        }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });

      const history = store._data.get('impls/graphql-java/history');
      assert.equal(history[0].falloutAfter, 2);
      assert.equal(history[0].total, 2);
    });
  });

  describe('conformerMeta', () => {
    it('is retrievable on the loaded run', () => {
      const store = ResultsStore.inMemory();
      store.writeRun({
        run: makeRun(), resultsByImpl: {},
        conformerMeta: makeMeta({ corpusFingerprint: 'fp-xyz' }), impls: makeImpls(),
      });
      const latest = store.loadLatestRun();
      assert.equal(latest.conformerMeta.corpusFingerprint, 'fp-xyz');
      assert.equal(latest.conformerMeta.implMeta['graphql-java'].imageDigest, 'sha256:java-digest');
    });

    it('is stripped from runs.json entries', () => {
      const store = ResultsStore.inMemory();
      store.writeRun({
        run: makeRun(), resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });
      const runs = store.listRuns();
      assert.ok(!('_conformerMeta' in runs[0]), 'runs.json entries must not leak conformer meta');
    });
  });

  describe('loadRun', () => {
    it('returns null for an unknown id', () => {
      const store = ResultsStore.inMemory();
      store.writeRun({ run: makeRun(), resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls() });
      assert.equal(store.loadRun('does-not-exist'), null);
    });

    it('returns the same shape as loadLatestRun for a known id', () => {
      const store = ResultsStore.inMemory();
      const run = makeRun({ id: 'specific-run' });
      store.writeRun({
        run,
        resultsByImpl: {
          'graphql-java': [{
            id: 'r1', runId: run.id, implId: 'graphql-java',
            testCaseId: 'a/b', status: 'fail',
          }],
        },
        conformerMeta: makeMeta(),
        impls: makeImpls(),
      });
      const loaded = store.loadRun('specific-run');
      assert.equal(loaded.run.id, 'specific-run');
      assert.equal(loaded.resultsByImpl['graphql-java'][0].testCaseId, 'a/b');
      assert.equal(loaded.conformerMeta.corpusFingerprint, 'fingerprint-1');
    });
  });

  describe('overwriting the same run id', () => {
    it('replaces the prior entry in runs.json rather than duplicating', () => {
      const store = ResultsStore.inMemory();
      const sameId = 'same-id';

      store.writeRun({
        run: makeRun({ id: sameId, timestamp: '2026-03-15T00:00:00Z' }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });

      store.writeRun({
        run: makeRun({
          id: sameId,
          timestamp: '2026-03-16T00:00:00Z',
          excluded: 5,
        }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });

      const runs = store.listRuns();
      assert.equal(runs.length, 1);
      assert.equal(runs[0].timestamp, '2026-03-16T00:00:00Z');
      assert.equal(runs[0].excluded, 5);
    });
  });

  describe('impl history', () => {
    it('omits a run from an impl\'s history when that impl was not in the run', () => {
      const store = ResultsStore.inMemory();

      // r1: both impls
      store.writeRun({
        run: makeRun({ id: 'r1', timestamp: '2026-03-15T00:00:00Z' }),
        resultsByImpl: {}, conformerMeta: makeMeta(), impls: makeImpls(),
      });

      // r2: only graphql-js present (graphql-java missing from resultsByImpl)
      store.writeRun({
        run: makeRun({
          id: 'r2',
          timestamp: '2026-03-16T00:00:00Z',
          implIds: ['graphql-js'],
          resultsByImpl: {
            'graphql-js': bucket('graphql-js', { total: 3, passed: 3 }),
          },
        }),
        resultsByImpl: {},
        conformerMeta: makeMeta(),
        impls: [makeImpls()[0]],
      });

      const javaHistory = store._data.get('impls/graphql-java/history');
      assert.equal(javaHistory.length, 1, 'java history should skip r2');
      assert.equal(javaHistory[0].runId, 'r1');

      const jsHistory = store._data.get('impls/graphql-js/history');
      assert.equal(jsHistory.length, 2);
      assert.equal(jsHistory[0].runId, 'r2');
    });
  });
});

describe('FileData', () => {
  it('writes run + results shards to disk and reads them back', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'results-store-'));
    try {
      const store = ResultsStore.fromDirectory(tmpDir);
      const run = makeRun();
      const resultsByImpl = {
        'graphql-js': [],
        'graphql-java': [
          { id: 'r1', runId: run.id, implId: 'graphql-java', testCaseId: 'a/b/c', status: 'fail' },
        ],
      };
      store.writeRun({ run, resultsByImpl, conformerMeta: makeMeta(), impls: makeImpls() });

      assert.ok(fs.existsSync(path.join(tmpDir, 'runs.json')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'impls.json')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'runs', run.id, 'summary.json')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'runs', run.id, 'results', 'graphql-java.json')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'impls', 'graphql-java', 'history.json')));

      const reloaded = ResultsStore.fromDirectory(tmpDir);
      const latest = reloaded.loadLatestRun();
      assert.equal(latest.run.id, run.id);
      assert.equal(latest.resultsByImpl['graphql-java'][0].testCaseId, 'a/b/c');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
