'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HARNESS = path.join(__dirname, 'index.js');
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFiles(files) {
  const paths = {};
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    paths[name] = p;
  }
  return paths;
}

function run(schemaPath, queryPath, variablesPath) {
  const args = [HARNESS, schemaPath, queryPath];
  if (variablesPath) args.push(variablesPath);
  const stdout = execFileSync('node', args, { encoding: 'utf8' });
  return JSON.parse(stdout);
}

describe('graphql-js conformer-harness', () => {
  it('resolves scalar fields per wiring spec', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Query {
          name: String
          age: Int
          score: Float
          active: Boolean
          id: ID
        }
      `,
      'query.graphql': '{ name age score active id }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { name: 'str', age: 2, score: 3.14, active: true, id: 'id' },
    });
  });

  it('resolves list fields with 2 items', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Query { tags: [String] }
      `,
      'query.graphql': '{ tags }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { tags: ['str', 'str'] },
    });
  });

  it('resolves enum as first declared value', () => {
    const f = writeFiles({
      'schema.graphqls': `
        enum Status { ACTIVE INACTIVE PENDING }
        type Query { status: Status }
      `,
      'query.graphql': '{ status }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { status: 'ACTIVE' },
    });
  });

  it('resolves union as alphabetically first member', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Dog { bark: String }
        type Cat { meow: String }
        union Pet = Dog | Cat
        type Query { pet: Pet }
      `,
      'query.graphql': '{ pet { ... on Cat { meow } ... on Dog { bark } } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    // Cat < Dog alphabetically, so Cat is picked
    assert.deepStrictEqual(result, {
      data: { pet: { meow: 'str' } },
    });
  });

  it('resolves interface as alphabetically last implementing type', () => {
    const f = writeFiles({
      'schema.graphqls': `
        interface Animal { name: String }
        type Aardvark implements Animal { name: String, snout: Float }
        type Zebra implements Animal { name: String, stripes: Int }
        type Query { animal: Animal }
      `,
      'query.graphql': '{ animal { name ... on Zebra { stripes } ... on Aardvark { snout } } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    // Zebra > Aardvark alphabetically, so Zebra is picked
    assert.deepStrictEqual(result, {
      data: { animal: { name: 'str', stripes: 2 } },
    });
  });

  it('handles variables argument', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Query { greet(name: String!): String }
      `,
      'query.graphql': 'query G($n: String!) { greet(name: $n) }',
      'variables.json': '{"n": "World"}',
    });
    const result = run(f['schema.graphqls'], f['query.graphql'], f['variables.json']);
    assert.deepStrictEqual(result, {
      data: { greet: 'str' },
    });
  });

  it('resolves nested objects', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Query { hero: Hero }
        type Hero { name: String, friends: [Hero] }
      `,
      'query.graphql': '{ hero { name friends { name } } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: {
        hero: {
          name: 'str',
          friends: [{ name: 'str' }, { name: 'str' }],
        },
      },
    });
  });
});
