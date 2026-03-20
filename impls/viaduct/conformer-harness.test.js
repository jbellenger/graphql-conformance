'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const JAR = path.join(__dirname, 'target', 'conformer-1.0.jar');
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-viaduct-test-'));
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
  const args = ['-jar', JAR, schemaPath, queryPath];
  if (variablesPath) args.push(variablesPath);
  const stdout = execFileSync('java', args, { encoding: 'utf8', timeout: 30_000 });
  return JSON.parse(stdout);
}

describe('viaduct conformer-harness', () => {
  it('resolves scalar fields per wiring spec', () => {
    const f = writeFiles({
      'schema.graphqls': `
        schema { query: Root }
        type Root {
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
        schema { query: Root }
        type Root { tags: [String] }
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
        schema { query: Root }
        type Root { status: Status }
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
        schema { query: Root }
        type Root { pet: Pet }
      `,
      'query.graphql': '{ pet { ... on Cat { meow } ... on Dog { bark } } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { pet: { meow: 'str' } },
    });
  });

  it('resolves interface as alphabetically last implementing type', () => {
    const f = writeFiles({
      'schema.graphqls': `
        schema { query: Root }
        interface Animal { name: String }
        type Aardvark implements Animal { name: String, snout: Float }
        type Zebra implements Animal { name: String, stripes: Int }
        type Root { animal: Animal }
      `,
      'query.graphql': '{ animal { name ... on Zebra { stripes } ... on Aardvark { snout } } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { animal: { name: 'str', stripes: 2 } },
    });
  });

  it('handles variables argument', () => {
    const f = writeFiles({
      'schema.graphqls': `
        schema { query: Root }
        type Root { greet(name: String!): String }
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
        schema { query: Root }
        type Root { hero: Hero }
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

  it('supports custom query root type names', () => {
    const f = writeFiles({
      'schema.graphqls': `
        schema { query: Root }
        type Root { x: String }
      `,
      'query.graphql': '{ x }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { x: 'str' },
    });
  });

  it('supports conventional query root type names without a schema block', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Query { x: String }
      `,
      'query.graphql': '{ x }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { x: 'str' },
    });
  });

  it('supports conventional mutation root type names without a schema block', () => {
    const f = writeFiles({
      'schema.graphqls': `
        type Query { _: Boolean }
        type Mutation { rename: String }
      `,
      'query.graphql': 'mutation { rename }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { rename: 'str' },
    });
  });

  it('executes schemas with custom scalars', () => {
    const f = writeFiles({
      'schema.graphqls': `
        scalar Custom
        type Query { value: Custom }
      `,
      'query.graphql': '{ value }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { value: 'str' },
    });
  });

  it('fails when schema redefines Node incompatibly', () => {
    const f = writeFiles({
      'schema.graphqls': `
        schema { query: Root }
        type Root { value: String }
        extend type Query {
          node(id: ID!): String
        }
      `,
      'query.graphql': '{ value }',
    });

    assert.throws(() => run(f['schema.graphqls'], f['query.graphql']), /Node|schema/i);
  });
});
