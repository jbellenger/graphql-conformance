'use strict';

const fs = require('fs');
const path = require('path');

function discoverCorpus(corpusDir) {
  const tests = [];

  const entries = fs.readdirSync(corpusDir, { withFileTypes: true });
  const schemaDirs = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  for (const schemaId of schemaDirs) {
    const schemaDir = path.join(corpusDir, schemaId);
    const schemaPath = path.join(schemaDir, 'schema.graphqls');

    if (!fs.existsSync(schemaPath)) continue;

    const schemaEntries = fs.readdirSync(schemaDir, { withFileTypes: true });
    const queryDirs = schemaEntries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();

    for (const queryId of queryDirs) {
      const queryDir = path.join(schemaDir, queryId);
      const queryPath = path.join(queryDir, 'query.graphql');

      if (!fs.existsSync(queryPath)) continue;

      const queryEntries = fs.readdirSync(queryDir, { withFileTypes: true });
      const varsDirs = queryEntries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();

      if (varsDirs.length === 0) {
        tests.push({
          testId: schemaId,
          queryId,
          schemaPath,
          queryPath,
          variablesPath: null,
        });
      } else {
        for (const varsId of varsDirs) {
          const varsDir = path.join(queryDir, varsId);
          const variablesPath = path.join(varsDir, 'variables.json');

          if (!fs.existsSync(variablesPath)) continue;

          tests.push({
            testId: schemaId,
            queryId: `${queryId}/${varsId}`,
            schemaPath,
            queryPath,
            variablesPath,
          });
        }
      }
    }
  }

  return tests;
}

module.exports = { discoverCorpus };
