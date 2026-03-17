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

function makeCorpus(schemaId, queryId, varsId, opts = {}) {
  const schemaDir = path.join(tmpDir, schemaId);
  const queryDir = path.join(schemaDir, queryId);

  fs.mkdirSync(queryDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, 'schema.graphqls'), opts.schema || '');
  fs.writeFileSync(path.join(queryDir, 'query.graphql'), opts.query || '');

  if (varsId) {
    const varsDir = path.join(queryDir, varsId);
    fs.mkdirSync(varsDir, { recursive: true });
    fs.writeFileSync(path.join(varsDir, 'variables.json'), opts.variables || '{}');
  }
}

describe('discoverCorpus', () => {
  it('discovers a schema/query/variables triple', () => {
    makeCorpus('abc123', 'def456', 'ghi789', {
      schema: 'type Query { x: Int }',
      query: '{ x }',
      variables: '{}',
    });

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].testId, 'abc123');
    assert.equal(tests[0].queryId, 'def456/ghi789');
    assert.ok(tests[0].schemaPath.endsWith('schema.graphqls'));
    assert.ok(tests[0].queryPath.endsWith('query.graphql'));
    assert.ok(tests[0].variablesPath.endsWith('variables.json'));
  });

  it('discovers multiple queries under one schema', () => {
    makeCorpus('s1', 'q1', 'v1');
    makeCorpus('s1', 'q2', 'v1');

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 2);
    assert.equal(tests[0].queryId, 'q1/v1');
    assert.equal(tests[1].queryId, 'q2/v1');
    // both share the same schema
    assert.equal(tests[0].schemaPath, tests[1].schemaPath);
  });

  it('discovers multiple variable sets under one query', () => {
    makeCorpus('s1', 'q1', 'v1');
    // add a second variables dir
    const v2Dir = path.join(tmpDir, 's1', 'q1', 'v2');
    fs.mkdirSync(v2Dir, { recursive: true });
    fs.writeFileSync(path.join(v2Dir, 'variables.json'), '{"a":1}');

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 2);
    assert.equal(tests[0].queryId, 'q1/v1');
    assert.equal(tests[1].queryId, 'q1/v2');
    // both share the same query
    assert.equal(tests[0].queryPath, tests[1].queryPath);
  });

  it('handles query with no variables subdirectories', () => {
    const schemaDir = path.join(tmpDir, 's1');
    const queryDir = path.join(schemaDir, 'q1');
    fs.mkdirSync(queryDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, 'schema.graphqls'), '');
    fs.writeFileSync(path.join(queryDir, 'query.graphql'), '');

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 1);
    assert.equal(tests[0].variablesPath, null);
  });

  it('skips schema dirs without schema.graphqls', () => {
    const dir = path.join(tmpDir, 'no-schema');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'readme.txt'), '');

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 0);
  });

  it('skips query dirs without query.graphql', () => {
    const schemaDir = path.join(tmpDir, 's1');
    const queryDir = path.join(schemaDir, 'q1');
    fs.mkdirSync(queryDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, 'schema.graphqls'), '');
    // no query.graphql in q1

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 0);
  });

  it('returns empty for empty corpus dir', () => {
    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 0);
  });

  it('sorts schemas, queries, and variables lexicographically', () => {
    makeCorpus('s2', 'q1', 'v1');
    makeCorpus('s1', 'q2', 'v1');
    makeCorpus('s1', 'q1', 'v2');
    makeCorpus('s1', 'q1', 'v1');

    const tests = discoverCorpus(tmpDir);
    assert.equal(tests.length, 4);
    assert.equal(tests[0].testId, 's1');
    assert.equal(tests[0].queryId, 'q1/v1');
    assert.equal(tests[1].testId, 's1');
    assert.equal(tests[1].queryId, 'q1/v2');
    assert.equal(tests[2].testId, 's1');
    assert.equal(tests[2].queryId, 'q2/v1');
    assert.equal(tests[3].testId, 's2');
    assert.equal(tests[3].queryId, 'q1/v1');
  });
});
