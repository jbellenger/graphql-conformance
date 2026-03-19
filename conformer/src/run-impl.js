'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getToolEnv } = require('./tools');

const implName = process.argv[2];
const testPath = process.argv[3];

if (!implName || !testPath) {
  process.stderr.write('Usage: node run-impl.js <impl-name> <test-path>\n');
  process.stderr.write('  e.g. node run-impl.js graphql-js corpus/0/0\n');
  process.exit(1);
}

const baseDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(baseDir, '..');
const config = JSON.parse(fs.readFileSync(path.join(baseDir, 'config.json'), 'utf8'));

const allImpls = [config.reference, ...config.conformants];
const impl = allImpls.find((i) => i.name === implName);
if (!impl) {
  process.stderr.write(`Unknown impl: ${implName}\n`);
  process.stderr.write(`Available: ${allImpls.map((i) => i.name).join(', ')}\n`);
  process.exit(1);
}

// Decompose test path: corpus/<schema>/<query>[/<variables>]
const absTestPath = path.resolve(rootDir, testPath);
const parts = path.relative(path.join(rootDir, 'corpus'), absTestPath).split(path.sep);

if (parts.length < 2) {
  process.stderr.write(`Invalid test path: ${testPath}\n`);
  process.stderr.write('Expected: corpus/<schema-hash>/<query-hash>[/<variables-hash>]\n');
  process.exit(1);
}

const schemaPath = path.join(rootDir, 'corpus', parts[0], 'schema.graphqls');
const queryPath = path.join(rootDir, 'corpus', parts[0], parts[1], 'query.graphql');
const variablesPath = parts.length >= 3
  ? path.join(rootDir, 'corpus', parts[0], parts[1], parts[2], 'variables.json')
  : null;

const args = variablesPath
  ? [schemaPath, queryPath, variablesPath]
  : [schemaPath, queryPath];

const implDir = path.resolve(rootDir, impl.path);
const [cmd, ...cmdArgs] = impl.command;

const env = getToolEnv(rootDir);
const result = spawnSync(cmd, [...cmdArgs, ...args], {
  cwd: implDir,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: 30_000,
});

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
