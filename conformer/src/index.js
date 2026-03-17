'use strict';

const fs = require('fs');
const path = require('path');
const { discoverCorpus } = require('./corpus');
const { runHarness } = require('./runner');
const { getVersion } = require('./builder');
const { compareResults } = require('./compare');
const { getToolEnv } = require('./tools');

function generateRunId() {
  const now = new Date();
  return now.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
}

function loadPriorRun(resultsDir) {
  const indexPath = path.join(resultsDir, 'index.json');
  if (!fs.existsSync(indexPath)) return null;

  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!index.runs || index.runs.length === 0) return null;

    const latestId = index.runs[0].id;
    const runPath = path.join(resultsDir, `${latestId}.json`);
    if (!fs.existsSync(runPath)) return null;

    return JSON.parse(fs.readFileSync(runPath, 'utf8'));
  } catch {
    return null;
  }
}

async function runImpl(impl, baseDir, args, env) {
  const implDir = path.resolve(baseDir, impl.path);
  return runHarness(impl.command, implDir, args, env);
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

  // Get versions
  const refDir = path.resolve(baseDir, config.reference.path);
  process.stderr.write(`Getting version for reference (${config.reference.name})...\n`);
  const refSha = getVersion(refDir);

  const conformantVersions = {};
  for (const conformant of config.conformants) {
    const implDir = path.resolve(baseDir, conformant.path);
    process.stderr.write(`Getting version for conformant (${conformant.name})...\n`);
    conformantVersions[conformant.name] = getVersion(implDir);
  }

  // Run tests
  const conformantTests = {};
  for (const conformant of config.conformants) {
    conformantTests[conformant.name] = {};
  }

  const env = getToolEnv(baseDir);

  // Determine which conformants to skip (incremental runs)
  const resultsDir = path.join(baseDir, 'results');
  const skippedConformants = {};
  const priorRun = loadPriorRun(resultsDir);

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

  for (const test of tests) {
    const { testId, queryId, schemaPath, queryPath, variablesPath } = test;

    const args = variablesPath
      ? [schemaPath, queryPath, variablesPath]
      : [schemaPath, queryPath];

    process.stderr.write(`  test ${testId}/${queryId}: running reference (${config.reference.name})...\n`);
    const refResult = await runImpl(config.reference, baseDir, args, env);

    if (refResult.error) {
      process.stderr.write(`    reference failed: ${refResult.error}\n`);
    }

    await Promise.all(conformantsToRun.map(async (conformant) => {
      const conformantResult = await runImpl(conformant, baseDir, args, env);
      const result = compareResults(refResult, conformantResult);
      conformantTests[conformant.name][`${testId}/${queryId}`] = result;
    }));
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
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const runPath = path.join(resultsDir, `${runId}.json`);
  fs.writeFileSync(runPath, JSON.stringify(runResult, null, 2) + '\n');
  process.stderr.write(`Results written to ${runPath}\n`);

  // Update index.json
  const indexPath = path.join(resultsDir, 'index.json');
  let index = { runs: [] };
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  }

  index.runs.unshift({ id: runId, timestamp });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
  process.stderr.write(`Index updated at ${indexPath}\n`);
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
