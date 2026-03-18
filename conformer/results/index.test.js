'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('./index');

let tmpDir;
let store;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'results-test-'));
  store = new ResultsStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRun(overrides = {}) {
  return {
    id: overrides.id || '2026-03-17T22-42-11Z',
    timestamp: overrides.timestamp || '2026-03-17T22:42:11.609Z',
    reference: overrides.reference || { name: 'graphql-js', sha: 'abc123' },
    conformants: overrides.conformants || {
      'graphql-java': {
        sha: 'def456',
        tests: {
          'a/b/c': { matches: true, quirks: [] },
          'd/e/f': { matches: true, quirks: [] },
          'g/h/i': { matches: false, quirks: [] },
        },
      },
    },
  };
}

describe('ResultsStore', () => {
  describe('recordRun', () => {
    it('writes run metadata and failures', () => {
      store.recordRun(makeRun());

      const runFile = path.join(tmpDir, 'runs', '2026-03-17T22-42-11Z.json');
      assert.ok(fs.existsSync(runFile));
      const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
      assert.equal(run.conformants['graphql-java'].total, 3);
      assert.equal(run.conformants['graphql-java'].passed, 2);

      const failFile = path.join(tmpDir, 'failures', 'graphql-java', '2026-03-17T22-42-11Z.json');
      assert.ok(fs.existsSync(failFile));
      const failures = JSON.parse(fs.readFileSync(failFile, 'utf8'));
      assert.equal(failures.length, 1);
      assert.equal(failures[0].testKey, 'g/h/i');
    });

    it('does not write failures file when all tests pass', () => {
      store.recordRun(makeRun({
        conformants: {
          'graphql-java': {
            sha: 'def456',
            tests: { 'a/b/c': { matches: true, quirks: [] } },
          },
        },
      }));

      const failDir = path.join(tmpDir, 'failures', 'graphql-java');
      assert.ok(!fs.existsSync(failDir));
    });
  });

  describe('listRuns', () => {
    it('returns runs in reverse chronological order', () => {
      store.recordRun(makeRun({ id: 'run-1', timestamp: '2026-03-15T00:00:00Z' }));
      store.recordRun(makeRun({ id: 'run-2', timestamp: '2026-03-16T00:00:00Z' }));

      const runs = store.listRuns();
      assert.equal(runs.length, 2);
      assert.equal(runs[0].id, 'run-2');
      assert.equal(runs[1].id, 'run-1');
    });

    it('returns empty for no runs', () => {
      assert.deepStrictEqual(store.listRuns(), []);
    });
  });

  describe('getSummary', () => {
    it('returns pass percentage for each impl', () => {
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
      store.recordRun(makeRun({ id: 'run-1', timestamp: '2026-03-15T00:00:00Z' }));
      store.recordRun(makeRun({
        id: 'run-2',
        timestamp: '2026-03-16T00:00:00Z',
        conformants: {
          'graphql-java': {
            sha: 'def456',
            tests: {
              'a/b/c': { matches: true, quirks: [] },
              'd/e/f': { matches: true, quirks: [] },
              'g/h/i': { matches: true, quirks: [] },
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
      store.recordRun(makeRun());

      const failures = store.getImplFailures('graphql-java');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].testKey, 'g/h/i');
    });

    it('returns empty when all tests pass', () => {
      store.recordRun(makeRun({
        conformants: {
          'graphql-java': {
            sha: 'x',
            tests: { 'a/b/c': { matches: true, quirks: [] } },
          },
        },
      }));

      assert.deepStrictEqual(store.getImplFailures('graphql-java'), []);
    });
  });

  describe('getTestStatus', () => {
    it('returns per-impl status for a test', () => {
      store.recordRun(makeRun({
        conformants: {
          'graphql-java': {
            sha: 'a',
            tests: { 'x/y/z': { matches: true, quirks: [] } },
          },
          'graphql-go': {
            sha: 'b',
            tests: { 'x/y/z': { matches: false, quirks: ['object-ordering'] } },
          },
        },
      }));

      const status = store.getTestStatus('x/y/z');
      assert.equal(status.length, 2);

      const java = status.find((s) => s.impl === 'graphql-java');
      assert.equal(java.passes, true);

      const go = status.find((s) => s.impl === 'graphql-go');
      assert.equal(go.passes, false);
      assert.deepStrictEqual(go.quirks, ['object-ordering']);
    });
  });

  describe('loadLatestRun', () => {
    it('reconstructs run with failures', () => {
      store.recordRun(makeRun());

      const run = store.loadLatestRun();
      assert.equal(run.id, '2026-03-17T22-42-11Z');
      assert.equal(run.reference.name, 'graphql-js');

      const java = run.conformants['graphql-java'];
      assert.equal(java.total, 3);
      assert.equal(java.passed, 2);
      assert.ok(java.tests['g/h/i']);
      assert.equal(java.tests['g/h/i'].matches, false);
    });

    it('returns null when no runs exist', () => {
      assert.equal(store.loadLatestRun(), null);
    });
  });
});
