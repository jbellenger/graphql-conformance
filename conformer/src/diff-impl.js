'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getToolEnv } = require('./tools');

const implName = process.argv[2];
const testPath = process.argv[3];

if (!implName || !testPath) {
  process.stderr.write('Usage: node diff-impl.js <impl-name> <test-path>\n');
  process.exit(1);
}

const baseDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(baseDir, '..');
const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8'));

const impl = config.impls[implName];
if (!impl) {
  process.stderr.write(`Unknown impl: ${implName}\n`);
  process.stderr.write(`Available: ${Object.keys(config.impls).join(', ')}\n`);
  process.exit(1);
}
const refName = config.reference;
const reference = config.impls[refName];

// Decompose test path
const absTestPath = path.resolve(rootDir, testPath);
const parts = path.relative(path.join(rootDir, 'corpus'), absTestPath).split(path.sep);

if (parts.length < 2) {
  process.stderr.write(`Invalid test path: ${testPath}\n`);
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

const env = getToolEnv(rootDir);

function run(implDef) {
  const implDir = path.resolve(rootDir, implDef.path);
  const [cmd, ...cmdArgs] = implDef.command;
  const result = spawnSync(cmd, [...cmdArgs, ...args], {
    cwd: implDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  if (result.error) return { error: result.error.message };
  if (result.status !== 0) return { error: `exit code ${result.status}` };
  try {
    return { result: JSON.parse(result.stdout.toString()) };
  } catch {
    return { error: 'invalid JSON' };
  }
}

const refResult = run(reference);
const implResult = run(impl);

if (refResult.error) {
  process.stderr.write(`reference (${refName}): ${refResult.error}\n`);
}
if (implResult.error) {
  process.stderr.write(`${implName}: ${implResult.error}\n`);
}
if (refResult.error || implResult.error) {
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
