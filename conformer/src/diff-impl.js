'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getRootDir,
  loadConfig,
  resolveImpl,
  parseCorpusTestPath,
  spawnImplSync,
  parseImplOutput,
} = require('./impl-cli');

const implName = process.argv[2];
const testPath = process.argv[3];

if (!implName || !testPath) {
  process.stderr.write('Usage: node diff-impl.js <impl-name> <test-path>\n');
  process.exit(1);
}

const rootDir = getRootDir();
const config = loadConfig(rootDir);

let impl;
try {
  impl = resolveImpl(config, implName);
} catch (err) {
  process.stderr.write(`Unknown impl: ${implName}\n`);
  process.stderr.write(`Available: ${err.available.join(', ')}\n`);
  process.exit(1);
}
const refName = config.reference;
const reference = config.impls[refName];

let test;
try {
  test = parseCorpusTestPath(rootDir, testPath);
} catch {
  process.stderr.write(`Invalid test path: ${testPath}\n`);
  process.exit(1);
}

function run(implDef) {
  return parseImplOutput(spawnImplSync(implDef, rootDir, test.args));
}

const refResult = run(reference);
const implResult = run(impl);

if (refResult.error) {
  process.stderr.write(`reference (${refName}) excluded this test: ${refResult.error}\n`);
  if (refResult.stderr) process.stderr.write(refResult.stderr);
  process.stderr.write('No diff available because the reference did not produce a result.\n');
  process.exit(1);
}
if (implResult.error) {
  process.stderr.write(`${implName}: ${implResult.error}\n`);
  process.exit(1);
}

const refJson = JSON.stringify(refResult.result, null, 2);
const implJson = JSON.stringify(implResult.result, null, 2);

if (refJson === implJson) {
  process.stdout.write('Identical.\n');
  process.exit(0);
}

// Write to temp files and diff
const os = require('os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-impl-'));
const refFile = path.join(tmpDir, `${refName}.json`);
const implFile = path.join(tmpDir, `${implName}.json`);
fs.writeFileSync(refFile, refJson + '\n');
fs.writeFileSync(implFile, implJson + '\n');

const diff = spawnSync('diff', ['--unified', '--color=always', refFile, implFile], {
  stdio: ['pipe', 'pipe', 'pipe'],
  encoding: 'utf8',
});
process.stdout.write(diff.stdout);

fs.rmSync(tmpDir, { recursive: true });
process.exit(1);
