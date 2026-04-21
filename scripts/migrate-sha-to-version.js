#!/usr/bin/env node
'use strict';

// One-shot migration: rename `sha` → `imageDigest` in every results/data/runs/*.json
// and synthesize `version: null`. The old `sha` value was an image digest
// (e.g. sha256:...), not a logical library version, so it moves to `imageDigest`.
// After the next conformance run, real versions sourced from each image's
// /impl-version file will overwrite the nulls.
//
// Idempotent: safe to run multiple times.

const fs = require('fs');
const path = require('path');

const runsDir = path.resolve(__dirname, '..', 'results', 'data', 'runs');
if (!fs.existsSync(runsDir)) {
  console.error(`No runs directory at ${runsDir}; nothing to migrate.`);
  process.exit(0);
}

const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort();
let migrated = 0;
let untouched = 0;

for (const file of files) {
  const abs = path.join(runsDir, file);
  const raw = fs.readFileSync(abs, 'utf8');
  const doc = JSON.parse(raw);
  let changed = false;

  if (doc.reference && 'sha' in doc.reference) {
    doc.reference.imageDigest = doc.reference.sha;
    doc.reference.version = null;
    delete doc.reference.sha;
    changed = true;
  }

  if (doc.conformants && typeof doc.conformants === 'object') {
    for (const [name, c] of Object.entries(doc.conformants)) {
      if (c && typeof c === 'object' && 'sha' in c) {
        c.imageDigest = c.sha;
        c.version = null;
        delete c.sha;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(abs, JSON.stringify(doc, null, 2) + '\n');
    migrated += 1;
    console.log(`  migrated ${file}`);
  } else {
    untouched += 1;
  }
}

console.log(`Done: ${migrated} migrated, ${untouched} already up-to-date.`);
