'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
const configPath = path.join(baseDir, 'config.json');
const resultsDir = path.join(baseDir, 'results');

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
        timeout: 60_000,
      });

      // Read index.json to find the run
      const indexPath = path.join(resultsDir, 'index.json');
      assert.ok(fs.existsSync(indexPath), 'index.json should exist');
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.ok(index.runs.length > 0, 'should have at least one run');

      const latestRun = index.runs[0];
      const runPath = path.join(resultsDir, `${latestRun.id}.json`);
      assert.ok(fs.existsSync(runPath), 'run file should exist');
      const runResult = JSON.parse(fs.readFileSync(runPath, 'utf8'));

      // Verify structure
      assert.equal(runResult.id, latestRun.id);
      assert.ok(runResult.timestamp);
      assert.equal(runResult.reference.name, 'graphql-js');
      assert.ok(runResult.reference.sha);
      assert.ok(runResult.conformants['graphql-js-copy']);
      assert.ok(runResult.conformants['graphql-js-copy'].sha);

      // Every test/query should match exactly with no quirks
      const tests = runResult.conformants['graphql-js-copy'].tests;
      for (const [key, result] of Object.entries(tests)) {
        assert.equal(result.matches, true, `test ${key}: matches was false`);
        assert.deepStrictEqual(result.quirks, [], `test ${key}: unexpected quirks`);
      }
    } finally {
      fs.writeFileSync(configPath, originalConfig);
      if (fs.existsSync(resultsDir)) {
        fs.rmSync(resultsDir, { recursive: true });
      }
    }
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and produces same results', () => {
    const originalConfig = fs.readFileSync(configPath, 'utf8');

    try {
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

      // First run — executes everything
      execFileSync('node', [path.join(baseDir, 'src/index.js')], {
        cwd: baseDir,
        timeout: 60_000,
      });

      const indexPath = path.join(resultsDir, 'index.json');
      const index1 = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const run1 = JSON.parse(fs.readFileSync(
        path.join(resultsDir, `${index1.runs[0].id}.json`), 'utf8'));

      // Second run — should skip the conformant (same SHA)
      const run2proc = spawnSync('node', [path.join(baseDir, 'src/index.js')], {
        cwd: baseDir,
        timeout: 60_000,
      });
      assert.equal(run2proc.status, 0, 'second run should succeed');

      const stderr = run2proc.stderr.toString();
      assert.ok(stderr.includes('Skipping conformant (graphql-js-copy)'),
        'should log that conformant was skipped');

      const index2 = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.equal(index2.runs.length, 2, 'should have two runs');

      const run2 = JSON.parse(fs.readFileSync(
        path.join(resultsDir, `${index2.runs[0].id}.json`), 'utf8'));

      // Results should be identical
      assert.deepStrictEqual(
        run2.conformants['graphql-js-copy'].tests,
        run1.conformants['graphql-js-copy'].tests,
        'skipped conformant should have same test results as prior run',
      );
    } finally {
      fs.writeFileSync(configPath, originalConfig);
      if (fs.existsSync(resultsDir)) {
        fs.rmSync(resultsDir, { recursive: true });
      }
    }
  });
});
