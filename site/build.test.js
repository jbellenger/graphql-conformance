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
    reference: { name: 'graphql-js', sha: 'abc123' },
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
    assert.equal(summary.length, 1);
    assert.equal(summary[0].impl, 'impl-a');
    assert.equal(summary[0].total, 2);
    assert.equal(summary[0].failed, 1);
    assert.equal(summary[0].passPct, 50);
    assert.equal(summary[0].sha, 'def456');
    assert.ok(summary[0].repo !== undefined);
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
