#!/usr/bin/env node
'use strict';

// One-off: rewrite run IDs in results/data/ from the legacy timestamp format
// (e.g. "2026-04-25T12-57-21-936Z") to opaque UUIDs. Preserves Run.timestamp
// as-is so ordering and display are unaffected.
//
// Also recomputes every Result.id via conformer's resultId(runId, implId,
// testCaseId) so the derivation invariant (see conformer/src/index.js)
// continues to hold on old data.
//
// Idempotent: re-running is a no-op because the UUID pattern no longer
// matches the legacy format.
//
// Usage:  node scripts/backfill-run-ids-to-uuid.js [--dry-run] [--data-dir DIR]

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resultId } = require('../conformer/src/index');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataIdx = args.indexOf('--data-dir');
const dataDir =
  dataIdx !== -1 ? args[dataIdx + 1] : path.join(__dirname, '..', 'results', 'data');

// Legacy IDs look like ISO timestamps with colons/dots swapped for hyphens,
// e.g. "2026-04-25T12-57-21-936Z". UUIDs never match this shape.
const LEGACY_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, v) {
  if (dryRun) return;
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

function collectLegacyIds() {
  const ids = new Set();

  const runsIdxPath = path.join(dataDir, 'runs.json');
  if (fs.existsSync(runsIdxPath)) {
    for (const r of readJson(runsIdxPath)) {
      if (LEGACY_RE.test(r.id)) ids.add(r.id);
    }
  }

  const runsDir = path.join(dataDir, 'runs');
  if (fs.existsSync(runsDir)) {
    for (const name of fs.readdirSync(runsDir)) {
      if (LEGACY_RE.test(name)) ids.add(name);
    }
  }

  const implsDir = path.join(dataDir, 'impls');
  if (fs.existsSync(implsDir)) {
    for (const impl of fs.readdirSync(implsDir)) {
      const histPath = path.join(implsDir, impl, 'history.json');
      if (!fs.existsSync(histPath)) continue;
      for (const h of readJson(histPath)) {
        if (LEGACY_RE.test(h.runId)) ids.add(h.runId);
      }
    }
  }

  return ids;
}

function main() {
  if (!fs.existsSync(dataDir)) {
    console.error(`No data dir at ${dataDir}; nothing to do.`);
    return;
  }

  const legacy = collectLegacyIds();
  if (legacy.size === 0) {
    console.log('No legacy run IDs found; nothing to do.');
    return;
  }

  const mapping = Object.fromEntries(
    [...legacy].map((id) => [id, crypto.randomUUID()]),
  );

  console.log(`Rewriting ${legacy.size} run ID(s)${dryRun ? ' (dry run)' : ''}:`);
  for (const [oldId, newId] of Object.entries(mapping)) {
    console.log(`  ${oldId} -> ${newId}`);
  }

  // 1) Rename run directories.
  const runsDir = path.join(dataDir, 'runs');
  if (fs.existsSync(runsDir)) {
    for (const name of fs.readdirSync(runsDir)) {
      if (!mapping[name]) continue;
      const from = path.join(runsDir, name);
      const to = path.join(runsDir, mapping[name]);
      if (dryRun) {
        console.log(`  rename ${from} -> ${to}`);
      } else {
        fs.renameSync(from, to);
      }
    }
  }

  // 2) Rewrite runs.json.
  const runsIdxPath = path.join(dataDir, 'runs.json');
  if (fs.existsSync(runsIdxPath)) {
    const runs = readJson(runsIdxPath).map((r) =>
      mapping[r.id] ? { ...r, id: mapping[r.id] } : r,
    );
    writeJson(runsIdxPath, runs);
  }

  // 3) Rewrite each history.json.
  const implsDir = path.join(dataDir, 'impls');
  if (fs.existsSync(implsDir)) {
    for (const impl of fs.readdirSync(implsDir)) {
      const histPath = path.join(implsDir, impl, 'history.json');
      if (!fs.existsSync(histPath)) continue;
      const hist = readJson(histPath).map((h) =>
        mapping[h.runId] ? { ...h, runId: mapping[h.runId] } : h,
      );
      writeJson(histPath, hist);
    }
  }

  // 4) Rewrite summary.json and every per-impl shard inside each (renamed)
  //    run directory. Also recompute each Result.id to preserve the derivation
  //    invariant in conformer/src/index.js.
  if (fs.existsSync(runsDir)) {
    for (const dirName of fs.readdirSync(runsDir)) {
      const runDir = path.join(runsDir, dirName);
      const summaryPath = path.join(runDir, 'summary.json');
      if (fs.existsSync(summaryPath)) {
        const summary = readJson(summaryPath);
        if (mapping[summary.id]) summary.id = mapping[summary.id];
        writeJson(summaryPath, summary);
      }
      const resultsDir = path.join(runDir, 'results');
      if (!fs.existsSync(resultsDir)) continue;
      for (const shardName of fs.readdirSync(resultsDir)) {
        const shardPath = path.join(resultsDir, shardName);
        const shard = readJson(shardPath).map((r) => {
          if (!mapping[r.runId]) return r;
          const newRunId = mapping[r.runId];
          return {
            ...r,
            runId: newRunId,
            id: resultId(newRunId, r.implId, r.testCaseId),
          };
        });
        writeJson(shardPath, shard);
      }
    }
  }

  if (dryRun) {
    console.log('Dry run — no files modified.');
  } else {
    console.log(`Done. Rewrote ${legacy.size} run ID(s).`);
  }
}

main();
