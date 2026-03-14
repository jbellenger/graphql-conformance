'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
const configPath = path.join(baseDir, 'config.json');
const resultsPath = path.join(baseDir, 'results.json');

describe('integration: self-comparison', () => {
  it('graphql-js vs itself produces all true', () => {
    // Temporarily write a config with graphql-js as both reference and conformant
    const originalConfig = fs.readFileSync(configPath, 'utf8');
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

    try {
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
      execFileSync('node', [path.join(baseDir, 'src/index.js')], {
        cwd: baseDir,
        timeout: 60_000,
      });

      const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

      // Every test/query/conformant should be true
      for (const [testId, queries] of Object.entries(results)) {
        for (const [queryId, conformants] of Object.entries(queries)) {
          for (const [name, passed] of Object.entries(conformants)) {
            assert.equal(passed, true, `test ${testId}/${queryId} conformant ${name} was false`);
          }
        }
      }
    } finally {
      fs.writeFileSync(configPath, originalConfig);
      if (fs.existsSync(resultsPath)) fs.unlinkSync(resultsPath);
    }
  });
});
