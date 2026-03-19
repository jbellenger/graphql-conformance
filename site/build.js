'use strict';

const fs = require('fs');
const path = require('path');

const resultsDir = process.argv[2];
if (!resultsDir) {
  console.error('Usage: node build.js <results-data-dir>');
  process.exit(1);
}

// Inline a minimal ResultsStore reader (avoid cross-package require)
function loadAllRuns(baseDir) {
  const runsDir = path.join(baseDir, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')));
}

function loadFailures(baseDir, implName, runId) {
  const f = path.join(baseDir, 'failures', implName, `${runId}.json`);
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// Load config for repo URLs
const configPath = path.join(__dirname, '..', 'conformer', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const repoByName = {};
for (const impl of [config.reference, ...config.conformants]) {
  if (impl.repo) repoByName[impl.name] = impl.repo;
}

const runs = loadAllRuns(resultsDir);
if (runs.length === 0) {
  console.error('No runs found.');
  process.exit(1);
}

const outDir = process.env.SITE_DATA_DIR || path.join(__dirname, 'data');

// summary.json — include reference impl with actual error tracking
const latest = runs[0];
const ref = latest.reference;
const refTotal = ref.total || Object.values(latest.conformants)[0]?.total || 0;
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
const implNames = new Set();
implNames.add(ref.name);
for (const run of runs) {
  for (const name of Object.keys(run.conformants)) {
    implNames.add(name);
  }
}

for (const name of implNames) {
  const implDir = path.join(outDir, 'impls', name);
  fs.mkdirSync(implDir, { recursive: true });

  // history.json
  const isRef = name === ref.name;
  const history = runs
    .filter((r) => isRef || r.conformants[name])
    .reverse()
    .map((r) => {
      if (isRef) {
        const total = r.reference.total || Object.values(r.conformants)[0]?.total || 0;
        const errors = r.reference.errors || 0;
        const passed = total - errors;
        return {
          date: r.timestamp.slice(0, 10),
          passPct: total > 0 ? Math.round((passed / total) * 1000) / 10 : 100,
          total,
          failed: errors,
        };
      }
      const c = r.conformants[name];
      return {
        date: r.timestamp.slice(0, 10),
        passPct: c.total > 0 ? Math.round((c.passed / c.total) * 1000) / 10 : 100,
        total: c.total,
        failed: c.total - c.passed,
      };
    });

  fs.writeFileSync(path.join(implDir, 'history.json'), JSON.stringify(history, null, 2) + '\n');

  // failures.json
  const failures = loadFailures(resultsDir, name, latest.id);
  fs.writeFileSync(path.join(implDir, 'failures.json'), JSON.stringify(failures, null, 2) + '\n');

  console.log(`Wrote ${name}: ${history.length} history entries, ${failures.length} failures`);
}

console.log('Site data build complete.');
