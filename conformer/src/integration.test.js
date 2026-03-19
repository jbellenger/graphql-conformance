'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../../results');

const baseDir = path.resolve(__dirname, '..');

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
  reference: {
    name: 'graphql-js',
    path: './impls/graphql-js',
    command: ['node', 'index.js'],
  },
  conformants: [
    {
      name: 'graphql-js-copy',
      path: './impls/graphql-js',
      command: ['node', 'index.js'],
    },
  ],
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
    const runResult = store.loadLatestRun();

    assert.ok(runResult, 'should have a run result');
    assert.ok(runResult.timestamp);
    assert.equal(runResult.reference.name, 'graphql-js');
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
    const run1 = store1.loadLatestRun();

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
      run2.conformants['graphql-js-copy'].tests,
      run1.conformants['graphql-js-copy'].tests,
      'skipped conformant should have same test results as prior run',
    );
  });
});
