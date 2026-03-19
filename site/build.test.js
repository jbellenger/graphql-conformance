'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../results');

const buildScript = path.join(__dirname, 'build.js');

let tmpResultsDir;
let tmpSiteDataDir;

beforeEach(() => {
  tmpResultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-results-'));
  tmpSiteDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-data-'));
});

afterEach(() => {
  fs.rmSync(tmpResultsDir, { recursive: true, force: true });
  fs.rmSync(tmpSiteDataDir, { recursive: true, force: true });
});

function seedResults(overrides = {}) {
  const store = ResultsStore.fromDirectory(tmpResultsDir);
  store.recordRun({
    id: overrides.id || 'run-1',
    timestamp: overrides.timestamp || '2026-03-19T00:00:00.000Z',
    reference: { name: 'graphql-js', sha: 'abc123', total: 2, errors: 0 },
    conformants: overrides.conformants || {
      'impl-a': {
        sha: 'def456',
        tests: {
          'x/y/z': { matches: true, quirks: [] },
          'a/b/c': { matches: false, quirks: [] },
        },
      },
    },
  });
}

describe('site/build.js', () => {
  it('produces summary.json with correct structure', () => {
    seedResults();
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    assert.equal(summary.length, 2);

    const ref = summary.find((s) => s.impl === 'graphql-js');
    assert.ok(ref, 'should include reference impl');
    assert.equal(ref.total, 2);
    assert.equal(ref.failed, 0);
    assert.equal(ref.passPct, 100);
    assert.equal(ref.sha, 'abc123');
    assert.equal(ref.isReference, true);

    const implA = summary.find((s) => s.impl === 'impl-a');
    assert.ok(implA, 'should include conformant impl');
    assert.equal(implA.total, 2);
    assert.equal(implA.failed, 1);
    assert.equal(implA.passPct, 50);
    assert.equal(implA.sha, 'def456');
    assert.ok(implA.repo !== undefined);
  });

  it('produces per-impl history.json and failures.json', () => {
    seedResults();
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const history = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'impl-a', 'history.json'), 'utf8')
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].date, '2026-03-19');
    assert.equal(history[0].passPct, 50);

    const failures = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'impl-a', 'failures.json'), 'utf8')
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].testKey, 'a/b/c');

    // Reference impl should also get data files
    const refHistory = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'history.json'), 'utf8')
    );
    assert.equal(refHistory.length, 1);
    assert.equal(refHistory[0].passPct, 100);
    assert.equal(refHistory[0].failed, 0);

    const refFailures = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'failures.json'), 'utf8')
    );
    assert.deepStrictEqual(refFailures, []);
  });

  it('shows reference errors when reference fails some tests', () => {
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'run-ref-errors',
      timestamp: '2026-03-19T00:00:00.000Z',
      reference: {
        name: 'graphql-js',
        sha: 'abc123',
        total: 5,
        errors: 2,
        failures: [
          { testKey: 'p/q/r', error: 'stack overflow' },
          { testKey: 's/t/u', error: 'process exited with code 1' },
        ],
      },
      conformants: {
        'impl-a': {
          sha: 'def456',
          tests: {
            'x/y/z': { matches: true, quirks: [] },
          },
        },
      },
    });
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    const ref = summary.find((s) => s.impl === 'graphql-js');
    assert.equal(ref.total, 5);
    assert.equal(ref.failed, 2);
    assert.equal(ref.passPct, 60);

    // Reference failures should be written with error fields (not quirks)
    const refFailures = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'failures.json'), 'utf8')
    );
    assert.equal(refFailures.length, 2);
    assert.equal(refFailures[0].testKey, 'p/q/r');
    assert.equal(refFailures[0].error, 'stack overflow');
    assert.equal(refFailures[1].testKey, 's/t/u');
  });

  it('exits with error when no runs exist', () => {
    assert.throws(() => {
      execFileSync('node', [buildScript, tmpResultsDir], {
        env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
        stdio: 'pipe',
      });
    });
  });
});
