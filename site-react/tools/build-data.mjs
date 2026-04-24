#!/usr/bin/env node
// Emits Repository-shaped JSON (plan P6.1) from the existing ResultsStore output.
//
// Usage:  node tools/build-data.mjs <results-data-dir> [<site-data-dir>]
// Defaults: site-data-dir = site-react/dist/data (or $SITE_DATA_DIR)
//
// Phase 1 scope: emit enough data to drive the dashboard (impls.json,
// runs.json, runs/<id>/summary.json). Per-impl result shards and
// test-case/-schema/-query/-variables shards will follow in a later
// iteration; Dashboard renders from summary.json alone.

import { createHash, randomUUID } from 'node:crypto';
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

// Reuse the repo's ResultsStore (CommonJS module).
const { ResultsStore } = await loadResultsStore();

const store = ResultsStore.fromDirectory(resultsDir);
const latest = store.loadLatestRunSummary();
if (!latest) {
  console.error(`No runs found under ${resultsDir}.`);
  process.exit(1);
}

const registry = loadRegistry();

// Build the Impl list from registry + reference impl + conformant impls. We
// use the registry's declared order so dashboard ordering is stable/meaningful.
const impls = buildImpls(registry, latest);

// Compose the Run object. id is derived deterministically from the results
// timestamp so re-running build-data.mjs for the same run produces the same
// id; UUID v4 generation is reserved for the conformer writer (per P6.1).
const runId = deterministicRunId(latest.timestamp);
const run = buildRun(runId, latest, impls);

// Write impls.json + runs.json (list + latest-only for now) + per-run summary.
writeJson(path.join(outDir, 'impls.json'), impls);
writeJson(path.join(outDir, 'runs.json'), [run]);
const runDir = path.join(outDir, 'runs', runId);
fs.mkdirSync(runDir, { recursive: true });
writeJson(path.join(runDir, 'summary.json'), run);

console.log(
  `Wrote ${impls.length} impls, run ${runId} to ${path.relative(repoRoot, outDir)}`,
);

// --- helpers ---------------------------------------------------------------

async function loadResultsStore() {
  // ResultsStore is published as a CommonJS module (`require('../results')`).
  // Use createRequire so this ESM script can load it without a shim.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  return require(path.join(repoRoot, 'results'));
}

function loadRegistry() {
  const registryPath = path.join(repoRoot, 'registry.json');
  if (!fs.existsSync(registryPath)) return { drivers: [] };
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  // Enrich each driver with its manifest, if present.
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

  /** @type {import('../src/repository/types').Impl[]} */
  const out = [];

  // Reference impl first.
  out.push(toImpl(latest.reference.name, byName.get(latest.reference.name), {
    isReference: true,
    version: latest.reference.version,
  }));

  // Non-reference impls, in registry order when possible.
  const seen = new Set([latest.reference.name]);
  const conformantNames = Object.keys(latest.conformants ?? {});
  const registryOrder = [...byName.keys()];
  const ordered = [
    ...registryOrder.filter(
      (n) => conformantNames.includes(n) && !seen.has(n),
    ),
    ...conformantNames.filter((n) => !registryOrder.includes(n) && !seen.has(n)),
  ];
  for (const name of ordered) {
    const version = latest.conformants[name]?.version;
    out.push(toImpl(name, byName.get(name), { isReference: false, version }));
    seen.add(name);
  }
  return out;
}

function toImpl(name, driver, { isReference, version }) {
  const manifest = driver?._manifest;
  const versionUrl = version && manifest?.versionUrlTemplate
    ? manifest.versionUrlTemplate.replace(/\{version\}/g, encodeURIComponent(version))
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
  // Reference impl: excluded comes from reference.excluded; errored is
  // reference errors (things the reference itself couldn't handle).
  resultsByImpl[refName] = {
    implId: refName,
    failed: 0,
    excluded: reference.excluded ?? 0,
    errored: reference.errors ?? 0,
    results: [],
  };
  for (const [name, summary] of Object.entries(latest.conformants ?? {})) {
    const failed = Math.max(0, (summary.total ?? 0) - (summary.passed ?? 0));
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

function deterministicRunId(timestamp) {
  if (process.env.RUN_ID) return process.env.RUN_ID;
  // Stable, readable ids for the UI during Phase 1. The real conformer will
  // generate UUIDs per-run in a later migration.
  const digest = createHash('sha256').update(timestamp).digest('hex');
  // Shape as a UUID v4-ish string so downstream code that expects UUIDs is
  // happy, but with deterministic bits.
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

// Suppress unused-import warning when lint is strict; randomUUID is kept for
// future use when writers (conformer) adopt proper UUIDs.
void randomUUID;
