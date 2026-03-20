'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../../results');
const { getVersion } = require('./builder');
const { discoverCorpus } = require('./corpus');

const baseDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(baseDir, '..');

let tmpDir;
let tmpResultsDir;
let tmpConfigPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conformer-integration-'));
  tmpResultsDir = path.join(tmpDir, 'results');
  fs.mkdirSync(tmpResultsDir);
  tmpConfigPath = path.join(tmpDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const testConfig = {
  reference: 'graphql-js-16',
  impls: {
    'graphql-js-16': {
      path: './impls/graphql-js-16',
      command: ['node', 'index.js'],
    },
    'graphql-js-copy': {
      path: './impls/graphql-js-16',
      command: ['node', 'index.js'],
    },
  },
};

function runConformer(env = {}) {
  return {
    cmd: 'node',
    args: [path.join(baseDir, 'src/index.js')],
    opts: {
      cwd: baseDir,
      timeout: 300_000,
      env: { ...process.env, RESULTS_DIR: tmpResultsDir, CONFIG_PATH: tmpConfigPath, ...env },
    },
  };
}

describe('integration: self-comparison', () => {
  it('graphql-js vs itself produces all true', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));

    const { cmd, args, opts } = runConformer();
    execFileSync(cmd, args, opts);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    const runResult = store.loadLatestRunSummary();

    assert.ok(runResult, 'should have a run result');
    assert.ok(runResult.timestamp);
    assert.equal(runResult.reference.name, 'graphql-js-16');
    assert.ok(runResult.reference.sha);
    assert.ok(runResult.conformants['graphql-js-copy']);
    assert.ok(runResult.conformants['graphql-js-copy'].sha);

    const failures = store.getImplFailures('graphql-js-copy');
    assert.equal(failures.length, 0, 'graphql-js vs itself should have no failures');
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and produces same results', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));

    const { cmd, args, opts } = runConformer();
    execFileSync(cmd, args, opts);

    const store1 = ResultsStore.fromDirectory(tmpResultsDir);
    const run1 = store1.loadLatestRunSummary();

    const run2proc = spawnSync(cmd, args, opts);
    assert.equal(run2proc.status, 0, 'second run should succeed');

    const stderr = run2proc.stderr.toString();
    assert.ok(stderr.includes('Skipping conformant (graphql-js-copy)'),
      'should log that conformant was skipped');

    const store2 = ResultsStore.fromDirectory(tmpResultsDir);
    const runs = store2.listRuns();
    assert.equal(runs.length, 2, 'should have two runs');

    const run2 = store2.loadLatestRun();

    assert.deepStrictEqual(
      run2.conformants['graphql-js-copy'].failuresByTestKey,
      run1.conformants['graphql-js-copy'].failuresByTestKey,
      'skipped conformant should have same test results as prior run',
    );
  });

  it('reuses failure-only skipped results without persisting passing test rows', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));

    const corpusTotal = discoverCorpus(path.join(rootDir, 'corpus')).length;
    const refSha = getVersion(path.join(rootDir, 'impls', 'graphql-js-16'));
    const conformantSha = getVersion(path.join(rootDir, 'impls', 'graphql-js-16'));
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'prior-run',
      timestamp: '2026-03-18T00:00:00.000Z',
      reference: {
        name: 'graphql-js-16',
        sha: refSha,
        total: corpusTotal,
        errors: 0,
      },
      conformants: {
        'graphql-js-copy': {
          sha: conformantSha,
          total: corpusTotal,
          passed: corpusTotal - 1,
          failuresByTestKey: {
            '0/0': { testKey: '0/0', error: 'seeded mismatch' },
          },
        },
      },
    });

    const { cmd, args, opts } = runConformer();
    const result = spawnSync(cmd, args, opts);
    assert.equal(result.status, 0, `stderr: ${result.stderr.toString()}`);
    assert.match(result.stderr.toString(), /Skipping conformant \(graphql-js-copy\)/);

    const latestRun = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(latestRun.conformants['graphql-js-copy'].total, corpusTotal);
    assert.equal(latestRun.conformants['graphql-js-copy'].passed, corpusTotal - 1);
    assert.deepStrictEqual(
      Object.keys(latestRun.conformants['graphql-js-copy'].failuresByTestKey),
      ['0/0'],
    );
  });
});
