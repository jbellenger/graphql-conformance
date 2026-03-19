'use strict';

const fs = require('fs');
const path = require('path');
const { discoverCorpus } = require('./corpus');
const { runHarness } = require('./runner');
const { getVersion } = require('./builder');
const { compareResults } = require('./compare');
const { getToolEnv } = require('./tools');
const { ResultsStore } = require('../../results');

function generateRunId() {
  const now = new Date();
  return now.toISOString().replace(/:/g, '-').replace(/\./g, '-').replace(/Z$/, 'Z');
}

async function runImpl(impl, rootDir, args, env) {
  const implDir = path.resolve(rootDir, impl.path);
  return runHarness(impl.command, implDir, args, env);
}

async function main() {
  const baseDir = path.resolve(__dirname, '..');
  const rootDir = path.resolve(baseDir, '..');
  const configPath = path.join(baseDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const corpusDir = path.join(rootDir, 'corpus');
  const tests = discoverCorpus(corpusDir);

  if (tests.length === 0) {
    process.stderr.write('No test cases found in corpus.\n');
    process.exit(1);
  }

  process.stderr.write(`Found ${tests.length} test case(s)\n`);

  // Get versions
  const refDir = path.resolve(rootDir, config.reference.path);
  process.stderr.write(`Getting version for reference (${config.reference.name})...\n`);
  const refSha = getVersion(refDir);

  const conformantVersions = {};
  for (const conformant of config.conformants) {
    const implDir = path.resolve(rootDir, conformant.path);
    process.stderr.write(`Getting version for conformant (${conformant.name})...\n`);
    conformantVersions[conformant.name] = getVersion(implDir);
  }

  // Run tests
  const conformantTests = {};
  for (const conformant of config.conformants) {
    conformantTests[conformant.name] = {};
  }

  const env = getToolEnv(rootDir);

  // Determine which conformants to skip (incremental runs)
  const resultsDir = process.env.RESULTS_DIR || path.join(rootDir, 'results', 'data');
  const store = ResultsStore.fromDirectory(resultsDir);
  const skippedConformants = {};
  const priorRun = store.loadLatestRun();

  const conformantsToRun = config.conformants.filter((conformant) => {
    const currentSha = conformantVersions[conformant.name];
    if (
      priorRun &&
      priorRun.reference.sha === refSha &&
      priorRun.conformants[conformant.name] &&
      priorRun.conformants[conformant.name].sha === currentSha
    ) {
      process.stderr.write(`Skipping conformant (${conformant.name}): unchanged (sha ${currentSha.slice(0, 7)})\n`);
      skippedConformants[conformant.name] = priorRun.conformants[conformant.name].tests;
      return false;
    }
    return true;
  });

  if (conformantsToRun.length === 0) {
    process.stderr.write('All conformants unchanged, skipping test execution.\n');
  } else {
    for (const test of tests) {
      const { testId, queryId, schemaPath, queryPath, variablesPath } = test;

      const args = variablesPath
        ? [schemaPath, queryPath, variablesPath]
        : [schemaPath, queryPath];

      process.stderr.write(`  test ${testId}/${queryId}: running reference (${config.reference.name})...\n`);
      const refResult = await runImpl(config.reference, rootDir, args, env);

      if (refResult.error) {
        process.stderr.write(`    reference failed: ${refResult.error}\n`);
      }

      await Promise.all(conformantsToRun.map(async (conformant) => {
        const conformantResult = await runImpl(conformant, rootDir, args, env);
        const result = compareResults(refResult, conformantResult);
        conformantTests[conformant.name][`${testId}/${queryId}`] = result;
      }));
    }
  }

  // Merge skipped conformant results
  for (const [name, tests] of Object.entries(skippedConformants)) {
    conformantTests[name] = tests;
  }

  // Build results object
  const runId = generateRunId();
  const timestamp = new Date().toISOString();

  const conformants = {};
  for (const conformant of config.conformants) {
    conformants[conformant.name] = {
      sha: conformantVersions[conformant.name],
      tests: conformantTests[conformant.name],
    };
  }

  const runResult = {
    id: runId,
    timestamp,
    reference: {
      name: config.reference.name,
      sha: refSha,
    },
    conformants,
  };

  // Write results
  store.recordRun(runResult);
  process.stderr.write(`Results written to ${resultsDir}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
