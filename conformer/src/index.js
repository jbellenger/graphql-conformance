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
  const configPath = process.env.CONFIG_PATH || path.join(rootDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const corpusDir = path.join(rootDir, 'corpus');
  const tests = discoverCorpus(corpusDir);

  const refName = config.reference;
  const reference = { name: refName, ...config.impls[refName] };
  const conformants = Object.entries(config.impls)
    .filter(([name]) => name !== refName)
    .map(([name, impl]) => ({ name, ...impl }));

  if (tests.length === 0) {
    process.stderr.write('No test cases found in corpus.\n');
    process.exit(1);
  }

  process.stderr.write(`Found ${tests.length} test case(s)\n`);

  // Get versions
  const refDir = path.resolve(rootDir, reference.path);
  process.stderr.write(`Getting version for reference (${reference.name})...\n`);
  const refSha = getVersion(refDir);

  const conformantVersions = {};
  for (const conformant of conformants) {
    const implDir = path.resolve(rootDir, conformant.path);
    process.stderr.write(`Getting version for conformant (${conformant.name})...\n`);
    conformantVersions[conformant.name] = getVersion(implDir);
  }

  // Run tests
  const conformantTests = {};
  for (const conformant of conformants) {
    conformantTests[conformant.name] = {};
  }

  const env = getToolEnv(rootDir);

  // Determine which conformants to skip (incremental runs)
  const resultsDir = process.env.RESULTS_DIR || path.join(rootDir, 'results', 'data');
  const store = ResultsStore.fromDirectory(resultsDir);
  const skippedConformants = {};
  const priorRun = store.loadLatestRun();

  const conformantsToRun = conformants.filter((conformant) => {
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

  const referenceFailures = [];

  if (conformantsToRun.length === 0) {
    process.stderr.write('All conformants unchanged, skipping test execution.\n');
  } else {
    for (const test of tests) {
      const { testId, queryId, schemaPath, queryPath, variablesPath } = test;

      const args = variablesPath
        ? [schemaPath, queryPath, variablesPath]
        : [schemaPath, queryPath];

      process.stderr.write(`  test ${testId}/${queryId}: running reference (${reference.name})...\n`);
      const refResult = await runImpl(reference, rootDir, args, env);

      if (refResult.error) {
        process.stderr.write(`    reference failed: ${refResult.error}\n`);
        const failure = { testKey: `${testId}/${queryId}`, error: refResult.error };
        if (refResult.stderr) failure.stderr = refResult.stderr;
        referenceFailures.push(failure);
      }

      await Promise.all(conformantsToRun.map(async (conformant) => {
        const conformantResult = await runImpl(conformant, rootDir, args, env);
        const result = compareResults(refResult, conformantResult);
        if (!result.matches) {
          if (refResult.result) result.expected = refResult.result;
          if (conformantResult.result) result.actual = conformantResult.result;
          if (conformantResult.error) result.error = conformantResult.error;
          if (conformantResult.stderr) result.stderr = conformantResult.stderr;
        }
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

  const conformantResults = {};
  for (const conformant of conformants) {
    const entry = {
      sha: conformantVersions[conformant.name],
      tests: conformantTests[conformant.name],
    };
    if (skippedConformants[conformant.name] && priorRun) {
      const prior = priorRun.conformants[conformant.name];
      if (prior) {
        entry.total = prior.total;
        entry.passed = prior.passed;
      }
    }
    conformantResults[conformant.name] = entry;
  }

  // For skipped runs, carry forward prior reference failures
  if (conformantsToRun.length === 0 && priorRun && priorRun.reference.failures) {
    referenceFailures.push(...priorRun.reference.failures);
  }

  const runResult = {
    id: runId,
    timestamp,
    reference: {
      name: reference.name,
      sha: refSha,
      total: tests.length,
      errors: referenceFailures.length,
      failures: referenceFailures,
    },
    conformants: conformantResults,
  };

  // Write results
  store.recordRun(runResult);
  process.stderr.write(`Results written to ${resultsDir}\n`);

  // Print summary
  const summary = store.getSummary();
  if (summary.length > 0) {
    const refTotal = runResult.reference.total || 0;
    const refErrors = runResult.reference.errors || 0;
    const refPassed = refTotal - refErrors;
    const refPct = refTotal > 0 ? ((refPassed / refTotal) * 100).toFixed(1) : '100.0';

    const allRows = [
      { impl: reference.name, passed: refPassed, total: refTotal, pct: refPct, failed: refErrors },
      ...summary.map((s) => ({
        impl: s.impl, passed: s.total - s.failed, total: s.total,
        pct: s.passPct.toFixed(1), failed: s.failed,
      })),
    ];
    const nameWidth = Math.max(...allRows.map((r) => r.impl.length));
    process.stderr.write('\n');
    process.stderr.write(
      `  ${'Impl'.padEnd(nameWidth)}  ${'Pass'.padStart(4)}/${'Total'.padStart(5)}   ${'Rate'.padStart(5)}  Status\n`,
    );
    process.stderr.write(`  ${'-'.repeat(nameWidth)}  ${'-'.repeat(4)} ${'-'.repeat(5)}  ${'-'.repeat(6)}  ${'-'.repeat(6)}\n`);
    for (const r of allRows) {
      const status = r.failed === 0 ? 'PASS' : 'FAIL';
      process.stderr.write(
        `  ${r.impl.padEnd(nameWidth)}  ${String(r.passed).padStart(4)}/${String(r.total).padStart(5)}  ${r.pct.padStart(6)}%  ${status}\n`,
      );
    }
    process.stderr.write('\n');
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
