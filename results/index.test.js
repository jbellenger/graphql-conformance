'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('./index');

function makeRun(overrides = {}) {
  return {
    id: overrides.id || '2026-03-17T22-42-11Z',
    timestamp: overrides.timestamp || '2026-03-17T22:42:11.609Z',
    reference: overrides.reference || { name: 'graphql-js', sha: 'abc123' },
    conformants: overrides.conformants || {
      'graphql-java': {
        sha: 'def456',
        tests: {
          'a/b/c': { matches: true },
          'd/e/f': { matches: true },
          'g/h/i': { matches: false },
        },
      },
    },
  };
}

describe('ResultsStore', () => {
  describe('recordRun + listRuns', () => {
    it('records and lists runs in reverse chronological order', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({ id: 'run-1', timestamp: '2026-03-15T00:00:00Z' }));
      store.recordRun(makeRun({ id: 'run-2', timestamp: '2026-03-16T00:00:00Z' }));

      const runs = store.listRuns();
      assert.equal(runs.length, 2);
      assert.equal(runs[0].id, 'run-2');
      assert.equal(runs[1].id, 'run-1');
    });

    it('returns empty for no runs', () => {
      assert.deepStrictEqual(ResultsStore.inMemory().listRuns(), []);
    });
  });

  describe('getSummary', () => {
    it('returns pass percentage for each impl', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun());

      const summary = store.getSummary();
      assert.equal(summary.length, 1);
      assert.equal(summary[0].impl, 'graphql-java');
      assert.equal(summary[0].total, 3);
      assert.equal(summary[0].failed, 1);
      assert.equal(summary[0].passPct, 66.7);
      assert.equal(summary[0].sha, 'def456');
    });
  });

  describe('getImplHistory', () => {
    it('returns history across runs', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({ id: 'run-1', timestamp: '2026-03-15T00:00:00Z' }));
      store.recordRun(makeRun({
        id: 'run-2',
        timestamp: '2026-03-16T00:00:00Z',
        conformants: {
          'graphql-java': {
            sha: 'def456',
            tests: {
              'a/b/c': { matches: true },
              'd/e/f': { matches: true },
              'g/h/i': { matches: true },
            },
          },
        },
      }));

      const history = store.getImplHistory('graphql-java');
      assert.equal(history.length, 2);
      assert.equal(history[0].date, '2026-03-15');
      assert.equal(history[0].passPct, 66.7);
      assert.equal(history[1].date, '2026-03-16');
      assert.equal(history[1].passPct, 100);
    });
  });

  describe('getImplFailures', () => {
    it('returns failures for latest run', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun());

      const failures = store.getImplFailures('graphql-java');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].testKey, 'g/h/i');
    });

    it('returns empty when all tests pass', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({
        conformants: {
          'graphql-java': {
            sha: 'x',
            tests: { 'a/b/c': { matches: true } },
          },
        },
      }));

      assert.deepStrictEqual(store.getImplFailures('graphql-java'), []);
    });
  });

  describe('getTestStatus', () => {
    it('returns per-impl status for a test', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({
        conformants: {
          'graphql-java': {
            sha: 'a',
            tests: { 'x/y/z': { matches: true } },
          },
          'graphql-go': {
            sha: 'b',
            tests: { 'x/y/z': { matches: false } },
          },
        },
      }));

      const status = store.getTestStatus('x/y/z');
      assert.equal(status.length, 2);

      const java = status.find((s) => s.impl === 'graphql-java');
      assert.equal(java.passes, true);

      const go = status.find((s) => s.impl === 'graphql-go');
      assert.equal(go.passes, false);
      assert.equal(go.passes, false);
    });
  });

  describe('recordRun with pre-computed totals', () => {
    it('uses provided total and passed instead of recomputing from tests', () => {
      const store = ResultsStore.inMemory();
      // Simulate a skipped conformant: the tests map only contains failures
      // (passing tests are not reconstructed by loadLatestRun), but the caller
      // provides the correct total/passed from the prior run.
      store.recordRun(makeRun({
        conformants: {
          'graphql-java': {
            sha: 'def456',
            tests: {
              'g/h/i': { matches: false },
            },
            total: 3,
            passed: 2,
          },
        },
      }));

      const summary = store.getSummary();
      assert.equal(summary.length, 1);
      assert.equal(summary[0].total, 3);
      assert.equal(summary[0].failed, 1);
      assert.equal(summary[0].passPct, 66.7);
    });

    it('falls back to computing from tests when total/passed not provided', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun());

      const summary = store.getSummary();
      assert.equal(summary[0].total, 3);
      assert.equal(summary[0].failed, 1);
    });
  });

  describe('reference failures', () => {
    it('stores and retrieves reference failures', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({
        reference: {
          name: 'graphql-js',
          sha: 'abc123',
          total: 3,
          errors: 1,
          failures: [{ testKey: 'x/y/z', error: 'stack overflow' }],
        },
      }));

      const failures = store.getImplFailures('graphql-js');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].testKey, 'x/y/z');
    });

    it('reconstructs reference failures in loadLatestRun', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({
        reference: {
          name: 'graphql-js',
          sha: 'abc123',
          total: 3,
          errors: 1,
          failures: [{ testKey: 'x/y/z', error: 'stack overflow' }],
        },
      }));

      const run = store.loadLatestRunSummary();
      assert.equal(run.reference.errors, 1);
      assert.equal(run.reference.failures.length, 1);
      assert.equal(run.reference.failures[0].testKey, 'x/y/z');
    });

    it('does not write failures file when reference has no errors', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun());

      const failures = store.getImplFailures('graphql-js');
      assert.deepStrictEqual(failures, []);
    });
  });

  describe('loadLatestRun', () => {
    it('returns an explicit failure-only summary', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun());

      const run = store.loadLatestRunSummary();
      assert.equal(run.id, '2026-03-17T22-42-11Z');
      assert.equal(run.reference.name, 'graphql-js');

      const java = run.conformants['graphql-java'];
      assert.equal(java.total, 3);
      assert.equal(java.passed, 2);
      assert.ok(java.failuresByTestKey['g/h/i']);
      assert.equal(java.failuresByTestKey['g/h/i'].testKey, 'g/h/i');
    });

    it('returns null when no runs exist', () => {
      assert.equal(ResultsStore.inMemory().loadLatestRunSummary(), null);
    });
  });

  describe('getReferenceHistory', () => {
    it('returns history for the reference implementation', () => {
      const store = ResultsStore.inMemory();
      store.recordRun(makeRun({
        id: 'run-1',
        timestamp: '2026-03-15T00:00:00Z',
        reference: { name: 'graphql-js', sha: 'abc123', total: 4, errors: 1 },
      }));
      store.recordRun(makeRun({
        id: 'run-2',
        timestamp: '2026-03-16T00:00:00Z',
        reference: { name: 'graphql-js', sha: 'def456', total: 4, errors: 0 },
      }));

      const history = store.getReferenceHistory();
      assert.equal(history.length, 2);
      assert.equal(history[0].date, '2026-03-15');
      assert.equal(history[0].failed, 1);
      assert.equal(history[0].passPct, 75);
      assert.equal(history[1].date, '2026-03-16');
      assert.equal(history[1].failed, 0);
      assert.equal(history[1].passPct, 100);
    });
  });
});

describe('FileData', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'results-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes run and failure files to disk', () => {
    const store = ResultsStore.fromDirectory(tmpDir);
    store.recordRun(makeRun());

    assert.ok(fs.existsSync(path.join(tmpDir, 'runs', '2026-03-17T22-42-11Z.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'failures', 'graphql-java', '2026-03-17T22-42-11Z.json')));
  });

  it('does not write failures file when all tests pass', () => {
    const store = ResultsStore.fromDirectory(tmpDir);
    store.recordRun(makeRun({
      conformants: {
        'graphql-java': {
          sha: 'def456',
          tests: { 'a/b/c': { matches: true } },
        },
      },
    }));

    assert.ok(!fs.existsSync(path.join(tmpDir, 'failures', 'graphql-java')));
  });
});
