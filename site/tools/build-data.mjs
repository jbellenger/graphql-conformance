#!/usr/bin/env node
// Emits Repository-shaped JSON (plan P6.1) from the existing ResultsStore output.
//
// Usage:  node tools/build-data.mjs <results-data-dir> [<site-data-dir>]
// Defaults: site-data-dir = site-react/dist/data (or $SITE_DATA_DIR)
//
// Emits:
//   impls.json                                — Impl[]
//   runs.json                                 — Run[] (currently latest only)
//   runs/<runId>/summary.json                 — Run with counts-only ImplRunResults
//   runs/<runId>/results/<implId>.json        — Result[] shard (non-pass only)
//   impls/<implId>/history.json               — ImplHistoryPoint[]

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const siteReactRoot = path.resolve(here, '..');
const repoRoot = path.resolve(siteReactRoot, '..');

const resultsDir = process.argv[2];
if (!resultsDir) {
  console.error(
    'Usage: node tools/build-data.mjs <results-data-dir> [<site-data-dir>]',
  );
  process.exit(1);
}

const outDir = path.resolve(
  process.argv[3] ??
    process.env.SITE_DATA_DIR ??
    path.join(siteReactRoot, 'dist', 'data'),
);

fs.mkdirSync(outDir, { recursive: true });

const { ResultsStore } = await loadResultsStore();
const store = ResultsStore.fromDirectory(resultsDir);
const latest = store.loadLatestRunSummary();
if (!latest) {
  console.error(`No runs found under ${resultsDir}.`);
  process.exit(1);
}

const registry = loadRegistry();
const impls = buildImpls(registry, latest);
const runId = deterministicRunId(latest.timestamp);
const run = buildRun(runId, latest, impls);

// impls.json (sorted by registry order; reference first).
writeJson(path.join(outDir, 'impls.json'), impls);

// runs.json + latest-run summary.
writeJson(path.join(outDir, 'runs.json'), [run]);
writeJson(path.join(outDir, 'runs', runId, 'summary.json'), run);

// Per-impl Result shards (non-pass only) + history.
const refName = latest.reference.name;
for (const impl of impls) {
  const implId = impl.id;
  const isRef = implId === refName;
  const rawFailures = isRef
    ? (latest.reference.exclusions ?? store.getReferenceExclusions())
    : (store.getImplFailures?.(implId) ?? []);
  const results = rawFailures.map((raw) =>
    toResult({
      runId,
      implId,
      raw,
      statusHint: isRef ? 'excluded' : undefined,
    }),
  );
  writeJson(
    path.join(outDir, 'runs', runId, 'results', `${implId}.json`),
    results,
  );

  const rawHistory = isRef
    ? store.getReferenceHistory()
    : store.getImplHistory(implId);
  const history = rawHistory.map((entry) => toHistoryPoint(entry));
  writeJson(path.join(outDir, 'impls', implId, 'history.json'), history);
}

console.log(
  `Wrote ${impls.length} impls, run ${runId}, per-impl shards + history to ${path.relative(repoRoot, outDir)}`,
);

// --- helpers ---------------------------------------------------------------

async function loadResultsStore() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  return require(path.join(repoRoot, 'results'));
}

function loadRegistry() {
  const registryPath = path.join(repoRoot, 'registry.json');
  if (!fs.existsSync(registryPath)) return { drivers: [] };
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const driver of raw.drivers ?? []) {
    if (!driver.manifestPath) continue;
    const manifestFile = path.resolve(
      path.dirname(registryPath),
      driver.manifestPath,
    );
    if (!fs.existsSync(manifestFile)) continue;
    driver._manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  }
  return raw;
}

function buildImpls(registry, latest) {
  const byName = new Map();
  for (const driver of registry.drivers ?? []) {
    byName.set(driver.name, driver);
  }

  const out = [];
  // Reference first.
  out.push(
    toImpl(latest.reference.name, byName.get(latest.reference.name), {
      isReference: true,
      version: latest.reference.version,
    }),
  );

  const seen = new Set([latest.reference.name]);
  const conformantNames = Object.keys(latest.conformants ?? {});
  const registryOrder = [...byName.keys()];
  const ordered = [
    ...registryOrder.filter(
      (n) => conformantNames.includes(n) && !seen.has(n),
    ),
    ...conformantNames.filter(
      (n) => !registryOrder.includes(n) && !seen.has(n),
    ),
  ];
  for (const name of ordered) {
    const version = latest.conformants[name]?.version;
    out.push(
      toImpl(name, byName.get(name), { isReference: false, version }),
    );
    seen.add(name);
  }
  return out;
}

function toImpl(name, driver, { isReference, version }) {
  const manifest = driver?._manifest;
  const versionUrl =
    version && manifest?.versionUrlTemplate
      ? manifest.versionUrlTemplate.replace(
          /\{version\}/g,
          encodeURIComponent(version),
        )
      : undefined;
  const repoUrl = manifest?.homepage;
  const language = manifest?.language ?? driver?.language ?? 'unknown';
  const manifestPath = driver?.manifestPath?.replace(/^\.\//, '');
  return {
    id: name,
    name: manifest?.displayName ?? name,
    language,
    isReference,
    manifestUrl: manifestPath
      ? `https://github.com/jbellenger/graphql-conformance/blob/master/${manifestPath}`
      : undefined,
    repoUrl,
    version: version ?? undefined,
    versionUrl,
  };
}

function buildRun(runId, latest, impls) {
  const reference = latest.reference;
  const refName = reference.name;
  const testCaseCount = reference.corpusTotal ?? reference.total ?? 0;

  const resultsByImpl = {};
  resultsByImpl[refName] = {
    implId: refName,
    failed: 0,
    excluded: reference.excluded ?? 0,
    errored: reference.errors ?? 0,
    results: [],
  };
  for (const [name, summary] of Object.entries(latest.conformants ?? {})) {
    const failed = Math.max(
      0,
      (summary.total ?? 0) - (summary.passed ?? 0),
    );
    resultsByImpl[name] = {
      implId: name,
      failed,
      excluded: 0,
      errored: 0,
      results: [],
    };
  }

  return {
    id: runId,
    timestamp: latest.timestamp,
    referenceImplId: refName,
    implIds: impls.map((i) => i.id),
    testCaseCount,
    resultsByImpl,
  };
}

function toResult({ runId, implId, raw, statusHint }) {
  const testCaseId = raw.testKey ?? raw.testCaseId ?? '';
  const id = deterministicResultId(runId, implId, testCaseId);
  const base = {
    id,
    runId,
    implId,
    testCaseId,
  };

  // Exclusions carry a `errors` array from the reference's failed GraphQL
  // execution. Render as a single "Response" block.
  if (statusHint === 'excluded' || Array.isArray(raw.errors)) {
    const response =
      raw.response ??
      (Array.isArray(raw.errors) ? { data: null, errors: raw.errors } : null);
    return {
      ...base,
      status: 'excluded',
      actual: response ?? undefined,
    };
  }

  // Driver/harness error: error string + stderr present.
  if (raw.error) {
    return {
      ...base,
      status: 'error',
      expected: raw.expected,
      error: raw.error,
      stderr: raw.stderr,
    };
  }

  // Output differs: both expected and actual present.
  return {
    ...base,
    status: 'fail',
    expected: raw.expected,
    actual: raw.actual,
  };
}

function toHistoryPoint(entry) {
  // Legacy history entries look like {date, passPct, total, failed, version}.
  // Exclusions aren't captured in legacy history for non-ref impls, so we
  // best-effort derive: exclusions = 0 (non-ref) or unspecified (ref).
  const total = entry.total ?? 0;
  const failed = entry.failed ?? 0;
  const excluded = entry.excluded ?? 0;
  const errored = entry.errored ?? 0;
  const timestamp = normalizeTimestamp(entry.timestamp ?? entry.date);
  return {
    runId: deterministicRunId(timestamp),
    timestamp,
    testCaseCount: total,
    failed,
    excluded,
    errored,
  };
}

function normalizeTimestamp(t) {
  if (!t) return '';
  // Accept full ISO8601 timestamps pass-through.
  if (/T\d/.test(t)) return t;
  // Bare dates: anchor at midnight UTC.
  return `${t}T00:00:00Z`;
}

function deterministicRunId(timestamp) {
  if (!timestamp) return '00000000-0000-4000-8000-000000000000';
  const digest = createHash('sha256').update(timestamp).digest('hex');
  const hex = digest.slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

function deterministicResultId(runId, implId, testCaseId) {
  const digest = createHash('sha256')
    .update(`${runId}|${implId}|${testCaseId}`)
    .digest('hex');
  const hex = digest.slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}
