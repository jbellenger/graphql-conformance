'use strict';

const path = require('path');
const fs = require('fs');
const { ResultsStore } = require('../results');

const resultsDir = process.argv[2];
if (!resultsDir) {
  console.error('Usage: node build.js <results-data-dir>');
  process.exit(1);
}

// Load registry + manifests for repo URLs and version-URL templates.
const repoByName = {};
const versionUrlTemplateByName = {};
const registryPath = path.join(__dirname, '..', 'registry.json');
if (fs.existsSync(registryPath)) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const driver of registry.drivers || []) {
    if (!driver.manifestPath) continue;
    const manifestFile = path.resolve(path.dirname(registryPath), driver.manifestPath);
    if (!fs.existsSync(manifestFile)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest.homepage) repoByName[driver.name] = manifest.homepage;
    if (manifest.versionUrlTemplate) versionUrlTemplateByName[driver.name] = manifest.versionUrlTemplate;
  }
}

function resolveVersionUrl(name, version) {
  if (!version) return null;
  const tpl = versionUrlTemplateByName[name];
  if (!tpl) return null;
  return tpl.replace(/\{version\}/g, encodeURIComponent(version));
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
    excluded: ref.excluded || 0,
    corpusTotal: ref.corpusTotal != null ? ref.corpusTotal : refTotal + refErrors,
    lastRun: latest.timestamp,
    version: ref.version || null,
    versionUrl: resolveVersionUrl(ref.name, ref.version),
    repo: repoByName[ref.name] || null,
    isReference: true,
  },
  ...Object.entries(latest.conformants).map(([name, c]) => ({
    impl: name,
    passPct: c.total > 0 ? Math.round((c.passed / c.total) * 1000) / 10 : 100,
    total: c.total,
    failed: c.total - c.passed,
    lastRun: latest.timestamp,
    version: c.version || null,
    versionUrl: resolveVersionUrl(name, c.version),
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

  if (isRef) {
    const exclusions = ref.exclusions || store.getReferenceExclusions();
    fs.writeFileSync(path.join(implDir, 'exclusions.json'), JSON.stringify(exclusions, null, 2) + '\n');
  }

  console.log(`Wrote ${name}: ${history.length} history entries, ${failures.length} failures`);
}

console.log('Site data build complete.');
