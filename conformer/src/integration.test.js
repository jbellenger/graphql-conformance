'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ResultsStore } = require('../results');

const baseDir = path.resolve(__dirname, '..');
const configPath = path.join(baseDir, 'config.json');
const resultsDataDir = path.join(baseDir, 'results', 'data');

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

describe('integration: self-comparison', () => {
  it('graphql-js vs itself produces all true', () => {
    const originalConfig = fs.readFileSync(configPath, 'utf8');

    try {
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
      execFileSync('node', [path.join(baseDir, 'src/index.js')], {
        cwd: baseDir,
        timeout: 300_000,
      });

      const store = new ResultsStore(resultsDataDir);
      const runResult = store.loadLatestRun();

      assert.ok(runResult, 'should have a run result');
      assert.ok(runResult.timestamp);
      assert.equal(runResult.reference.name, 'graphql-js');
      assert.ok(runResult.reference.sha);
      assert.ok(runResult.conformants['graphql-js-copy']);
      assert.ok(runResult.conformants['graphql-js-copy'].sha);

      // No failures should exist (graphql-js vs itself)
      const failures = store.getImplFailures('graphql-js-copy');
      assert.equal(failures.length, 0, 'graphql-js vs itself should have no failures');
    } finally {
      fs.writeFileSync(configPath, originalConfig);
      if (fs.existsSync(resultsDataDir)) {
        fs.rmSync(resultsDataDir, { recursive: true });
      }
    }
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and produces same results', () => {
    const originalConfig = fs.readFileSync(configPath, 'utf8');

    try {
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

      // First run
      execFileSync('node', [path.join(baseDir, 'src/index.js')], {
        cwd: baseDir,
        timeout: 300_000,
      });

      const store1 = new ResultsStore(resultsDataDir);
      const run1 = store1.loadLatestRun();

      // Second run — should skip the conformant (same SHA)
      const run2proc = spawnSync('node', [path.join(baseDir, 'src/index.js')], {
        cwd: baseDir,
        timeout: 300_000,
      });
      assert.equal(run2proc.status, 0, 'second run should succeed');

      const stderr = run2proc.stderr.toString();
      assert.ok(stderr.includes('Skipping conformant (graphql-js-copy)'),
        'should log that conformant was skipped');

      const store2 = new ResultsStore(resultsDataDir);
      const runs = store2.listRuns();
      assert.equal(runs.length, 2, 'should have two runs');

      const run2 = store2.loadLatestRun();

      // Results should be identical
      assert.deepStrictEqual(
        run2.conformants['graphql-js-copy'].tests,
        run1.conformants['graphql-js-copy'].tests,
        'skipped conformant should have same test results as prior run',
      );
    } finally {
      fs.writeFileSync(configPath, originalConfig);
      if (fs.existsSync(resultsDataDir)) {
        fs.rmSync(resultsDataDir, { recursive: true });
      }
    }
  });
});
