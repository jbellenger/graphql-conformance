'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { discoverCorpus } = require('./corpus');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeTest(testId, files) {
  const dir = path.join(tmpDir, testId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content || '');
  }
}

describe('discoverCorpus', () => {
  it('discovers a single query with variables', () => {
    makeTest('1', {
      'schema.graphqls': 'type Query { x: Int }',
      '1-query.graphql': '{ x }',
      '1-variables.json': '{}',
    });

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].testId, '1');
    assert.equal(tests[0].queryId, '1');
    assert.ok(tests[0].schemaPath.endsWith('schema.graphqls'));
    assert.ok(tests[0].queryPath.endsWith('1-query.graphql'));
    assert.ok(tests[0].variablesPath.endsWith('1-variables.json'));
  });

  it('discovers multiple queries in one test', () => {
    makeTest('1', {
      'schema.graphqls': '',
      '1-query.graphql': '',
      '2-query.graphql': '',
    });

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 2);
    assert.equal(tests[0].queryId, '1');
    assert.equal(tests[1].queryId, '2');
  });

  it('handles missing variables file', () => {
    makeTest('1', {
      'schema.graphqls': '',
      '1-query.graphql': '',
    });

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].variablesPath, null);
  });

  it('returns empty for test dir with no queries', () => {
    makeTest('1', {
      'schema.graphqls': '',
    });

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 0);
  });

  it('returns empty for empty corpus dir', () => {
    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 0);
  });

  it('sorts test dirs and queries lexicographically', () => {
    makeTest('2', { 'schema.graphqls': '', '1-query.graphql': '' });
    makeTest('1', { 'schema.graphqls': '', '2-query.graphql': '', '1-query.graphql': '' });

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 3);
    assert.equal(tests[0].testId, '1');
    assert.equal(tests[0].queryId, '1');
    assert.equal(tests[1].testId, '1');
    assert.equal(tests[1].queryId, '2');
    assert.equal(tests[2].testId, '2');
    assert.equal(tests[2].queryId, '1');
  });
});
