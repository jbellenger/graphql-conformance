'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getToolEnv } = require('./tools');

function getRootDir() {
  const baseDir = path.resolve(__dirname, '..');
  return path.resolve(baseDir, '..');
}

function loadConfig(rootDir = getRootDir()) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8'));
}

function resolveImpl(config, implName) {
  const impl = config.impls[implName];
  if (!impl) {
    const err = new Error(`Unknown impl: ${implName}`);
    err.available = Object.keys(config.impls);
    throw err;
  }
  return impl;
}

function parseCorpusTestPath(rootDir, testPath) {
  const corpusRoot = path.join(rootDir, 'corpus');
  const absTestPath = path.resolve(rootDir, testPath);
  const relative = path.relative(corpusRoot, absTestPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid test path: ${testPath}`);
  }

  const parts = relative.split(path.sep);
  if (parts.length < 2) {
    throw new Error(`Invalid test path: ${testPath}`);
  }

  const schemaPath = path.join(corpusRoot, parts[0], 'schema.graphqls');
  const queryPath = path.join(corpusRoot, parts[0], parts[1], 'query.graphql');
  const variablesPath = parts.length >= 3
    ? path.join(corpusRoot, parts[0], parts[1], parts[2], 'variables.json')
    : null;

  return {
    schemaPath,
    queryPath,
    variablesPath,
    args: variablesPath ? [schemaPath, queryPath, variablesPath] : [schemaPath, queryPath],
  };
}

function spawnImplSync(implDef, rootDir, args) {
  const implDir = path.resolve(rootDir, implDef.path);
  const [cmd, ...cmdArgs] = implDef.command;
  const env = getToolEnv(rootDir);
  return spawnSync(cmd, [...cmdArgs, ...args], {
    cwd: implDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  });
}

function parseImplOutput(result) {
  if (result.error) return { error: result.error.message };
  if (result.status !== 0) return { error: `process exited with code ${result.status}`, stderr: result.stderr.toString() };
  try {
    return { result: JSON.parse(result.stdout.toString()) };
  } catch {
    return { error: 'invalid JSON output', stderr: result.stderr.toString() };
  }
}

module.exports = {
  getRootDir,
  loadConfig,
  resolveImpl,
  parseCorpusTestPath,
  spawnImplSync,
  parseImplOutput,
};
