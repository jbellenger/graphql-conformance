'use strict';

const fs = require('fs');
const path = require('path');
const { discoverCorpus } = require('./corpus');
const { runHarness } = require('./runner');
const { exactEqual } = require('./compare');

async function runImpl(impl, baseDir, args) {
  const implDir = path.resolve(baseDir, impl.path);
  return runHarness(impl.command, implDir, args);
}

async function main() {
  const baseDir = path.resolve(__dirname, '..');
  const configPath = path.join(baseDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const corpusDir = path.join(baseDir, 'corpus');
  const tests = discoverCorpus(corpusDir);

  if (tests.length === 0) {
    process.stderr.write('No test cases found in corpus.\n');
    process.exit(1);
  }

  process.stderr.write(`Found ${tests.length} test case(s)\n`);

  const results = {};

  for (const test of tests) {
    const { testId, queryId, schemaPath, queryPath, variablesPath } = test;

    if (!results[testId]) results[testId] = {};

    const args = variablesPath
      ? [schemaPath, queryPath, variablesPath]
      : [schemaPath, queryPath];

    process.stderr.write(`  test ${testId}/${queryId}: running reference (${config.reference.name})...\n`);
    const refResult = await runImpl(config.reference, baseDir, args);

    if (refResult.error) {
      process.stderr.write(`    reference failed: ${refResult.error}\n`);
    }

    const queryResults = {};
    for (const conformant of config.conformants) {
      process.stderr.write(`  test ${testId}/${queryId}: running conformant (${conformant.name})...\n`);
      const conformantResult = await runImpl(conformant, baseDir, args);
      queryResults[conformant.name] = exactEqual(refResult, conformantResult);
    }

    results[testId][queryId] = queryResults;
  }

  const resultsPath = path.join(baseDir, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n');
  process.stderr.write(`Results written to ${resultsPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
