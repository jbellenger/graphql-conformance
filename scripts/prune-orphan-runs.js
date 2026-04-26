#!/usr/bin/env node
'use strict';

// One-off: remove run-index entries that point at runs without an on-disk
// directory under results/data/runs/<id>/. Orphans arise when a run dir
// gets cleaned up but the indexes weren't updated (historical cruft).
//
// Scope:
//   - results/data/runs.json
//   - results/data/impls/<implId>/history.json
//
// Usage: node scripts/prune-orphan-runs.js [--dry-run] [--data-dir DIR]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dataIdx = args.indexOf('--data-dir');
const dataDir =
  dataIdx !== -1 ? args[dataIdx + 1] : path.join(__dirname, '..', 'results', 'data');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, v) {
  if (dryRun) return;
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

function main() {
  const runsDir = path.join(dataDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    console.error(`No runs dir at ${runsDir}; nothing to do.`);
    return;
  }
  const onDisk = new Set(fs.readdirSync(runsDir));

  // Find orphans by scanning runs.json.
  const runsIdxPath = path.join(dataDir, 'runs.json');
  const runs = fs.existsSync(runsIdxPath) ? readJson(runsIdxPath) : [];
  const orphans = new Set(
    runs.filter((r) => !onDisk.has(r.id)).map((r) => r.id),
  );

  if (orphans.size === 0) {
    console.log('No orphan runs found; nothing to do.');
    return;
  }

  console.log(
    `Removing ${orphans.size} orphan run(s)${dryRun ? ' (dry run)' : ''}:`,
  );
  for (const id of orphans) console.log(`  ${id}`);

  // 1) runs.json.
  if (fs.existsSync(runsIdxPath)) {
    const kept = runs.filter((r) => !orphans.has(r.id));
    writeJson(runsIdxPath, kept);
  }

  // 2) impls/*/history.json.
  const implsDir = path.join(dataDir, 'impls');
  if (fs.existsSync(implsDir)) {
    for (const impl of fs.readdirSync(implsDir)) {
      const histPath = path.join(implsDir, impl, 'history.json');
      if (!fs.existsSync(histPath)) continue;
      const hist = readJson(histPath);
      const kept = hist.filter((h) => !orphans.has(h.runId));
      if (kept.length !== hist.length) writeJson(histPath, kept);
    }
  }

  console.log(dryRun ? 'Dry run — no files modified.' : 'Done.');
}

main();
