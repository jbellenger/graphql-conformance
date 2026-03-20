'use strict';

const path = require('path');
const fs = require('fs');
const { ResultsStore } = require('../results');

const resultsDir = process.argv[2];
if (!resultsDir) {
  console.error('Usage: node build.js <results-data-dir>');
  process.exit(1);
}

// Load config for repo URLs
const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const repoByName = {};
for (const [name, impl] of Object.entries(config.impls)) {
  if (impl.repo) repoByName[name] = impl.repo;
}

const store = ResultsStore.fromDirectory(resultsDir);
const latest = store.loadLatestRunSummary();
if (!latest) {
  console.error('No runs found.');
  process.exit(1);
}

const outDir = process.env.SITE_DATA_DIR || path.join(__dirname, 'data');

// summary.json — include reference impl with actual error tracking
const ref = latest.reference;
const refTotal = ref.total || 0;
const refErrors = ref.errors || 0;
const refPassed = refTotal - refErrors;
const summary = [
  {
    impl: ref.name,
    passPct: refTotal > 0 ? Math.round((refPassed / refTotal) * 1000) / 10 : 100,
    total: refTotal,
    failed: refErrors,
    lastRun: latest.timestamp,
    sha: ref.sha,
    repo: repoByName[ref.name] || null,
    isReference: true,
  },
  ...Object.entries(latest.conformants).map(([name, c]) => ({
    impl: name,
    passPct: c.total > 0 ? Math.round((c.passed / c.total) * 1000) / 10 : 100,
    total: c.total,
    failed: c.total - c.passed,
    lastRun: latest.timestamp,
    sha: c.sha,
    repo: repoByName[name] || null,
  })),
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`Wrote summary.json (${summary.length} impl(s))`);

// Per-impl data (include reference)
const implNames = [ref.name, ...Object.keys(latest.conformants)];

for (const name of implNames) {
  const implDir = path.join(outDir, 'impls', name);
  fs.mkdirSync(implDir, { recursive: true });

  // history.json
  const isRef = name === ref.name;
  const history = isRef ? store.getReferenceHistory() : store.getImplHistory(name);

  fs.writeFileSync(path.join(implDir, 'history.json'), JSON.stringify(history, null, 2) + '\n');

  // failures.json
  const failures = isRef ? ref.failures : store.getImplFailures(name);
  fs.writeFileSync(path.join(implDir, 'failures.json'), JSON.stringify(failures, null, 2) + '\n');

  console.log(`Wrote ${name}: ${history.length} history entries, ${failures.length} failures`);
}

console.log('Site data build complete.');
