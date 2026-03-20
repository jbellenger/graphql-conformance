'use strict';

const {
  getRootDir,
  loadConfig,
  resolveImpl,
  parseCorpusTestPath,
  spawnImplSync,
} = require('./impl-cli');

const implName = process.argv[2];
const testPath = process.argv[3];

if (!implName || !testPath) {
  process.stderr.write('Usage: node run-impl.js <impl-name> <test-path>\n');
  process.stderr.write('  e.g. node run-impl.js graphql-js corpus/0/0\n');
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

let test;
try {
  test = parseCorpusTestPath(rootDir, testPath);
} catch {
  process.stderr.write(`Invalid test path: ${testPath}\n`);
  process.stderr.write('Expected: corpus/<schema-hash>/<query-hash>[/<variables-hash>]\n');
  process.exit(1);
}

const result = spawnImplSync(impl, rootDir, test.args);

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
if (result.stdout && result.stdout.length > 0) {
  try {
    const json = JSON.parse(result.stdout.toString());
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  } catch {
    process.stdout.write(result.stdout);
  }
}
if (result.stderr && result.stderr.length > 0) process.stderr.write(result.stderr);
process.exit(result.status || 0);
