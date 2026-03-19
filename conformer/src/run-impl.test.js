'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');

function make(args, env) {
  return spawnSync('make', args, {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

describe('make run-impl', () => {
  it('prints usage when IMPL is missing', () => {
    const result = make(['run-impl', 'TEST=corpus/0/0']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('Usage: make run-impl'));
  });

  it('prints usage when TEST is missing', () => {
    const result = make(['run-impl', 'IMPL=graphql-js']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('Usage: make run-impl'));
  });

  it('prints error for unknown impl', () => {
    const result = make(['run-impl', 'IMPL=nonexistent', 'TEST=corpus/0/0']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Unknown impl: nonexistent'));
  });

  it('prints error for invalid test path', () => {
    const result = make(['run-impl', 'IMPL=graphql-js', 'TEST=corpus/0']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Invalid test path'));
  });

  it('runs graphql-js on corpus/0 and returns valid JSON', () => {
    const result = make(['run-impl', 'IMPL=graphql-js', 'TEST=corpus/0/0']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const json = JSON.parse(result.stdout);
    assert.ok(json.data, 'output should have a data field');
  });

  it('pretty-prints the JSON output', () => {
    const result = make(['run-impl', 'IMPL=graphql-js', 'TEST=corpus/0/0']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('\n'), 'output should be multi-line');
    assert.ok(result.stdout.startsWith('{\n'), 'output should start with formatted JSON');
  });
});

describe('make diff-impl', () => {
  it('prints usage when IMPL is missing', () => {
    const result = make(['diff-impl', 'TEST=corpus/0/0']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('Usage: make diff-impl'));
  });

  it('prints usage when TEST is missing', () => {
    const result = make(['diff-impl', 'IMPL=graphql-js']);
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('Usage: make diff-impl'));
  });

  it('reports identical when impl matches reference', () => {
    const result = make(['diff-impl', 'IMPL=graphql-java', 'TEST=corpus/0/0']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('Identical'));
  });
});
