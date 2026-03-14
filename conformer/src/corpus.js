'use strict';

const fs = require('fs');
const path = require('path');

function discoverCorpus(corpusDir) {
  const tests = [];

  const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
  const testDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  for (const testId of testDirs) {
    const testDir = path.join(corpusDir, testId);
    const schemaPath = path.join(testDir, 'schema.graphqls');

    const files = fs.readdirSync(testDir);
    const queryFiles = files
      .filter(f => f.endsWith('-query.graphql'))
      .sort();

    for (const queryFile of queryFiles) {
      const prefix = queryFile.replace(/-query\.graphql$/, '');
      const queryPath = path.join(testDir, queryFile);
      const variablesFile = `${prefix}-variables.json`;
      const variablesPath = path.join(testDir, variablesFile);
      const hasVariables = fs.existsSync(variablesPath);

      tests.push({
        testId,
        queryId: prefix,
        schemaPath,
        queryPath,
        variablesPath: hasVariables ? variablesPath : null,
      });
    }
  }

  return tests;
}

module.exports = { discoverCorpus };
