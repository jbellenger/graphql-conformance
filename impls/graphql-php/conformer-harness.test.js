'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT = path.join(__dirname, 'index.php');

function findPhp() {
  try {
    return execFileSync('which', ['php'], { encoding: 'utf8' }).trim();
  } catch {
    try {
      const miseDir = execFileSync('mise', ['where', 'php'], { encoding: 'utf8' }).trim();
      const binPhp = path.join(miseDir, 'bin', 'php');
      if (fs.existsSync(binPhp)) return binPhp;
      const rootPhp = path.join(miseDir, 'php');
      if (fs.existsSync(rootPhp)) return rootPhp;
      return miseDir;
    } catch {
      return 'php';
    }
  }
}

const PHP = findPhp();
let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gql-php-test-'));
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
  const args = [SCRIPT, schemaPath, queryPath];
  if (variablesPath) args.push(variablesPath);
  const stdout = execFileSync(PHP, args, { encoding: 'utf8', timeout: 30_000 });
  return JSON.parse(stdout);
}

describe('graphql-php conformer-harness', () => {
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

  it('handles schemas that redeclare built-in directives', () => {
    const f = writeFiles({
      'schema.graphqls': `
        "Directs the executor to include this field or fragment only when the if argument is true."
        directive @include(if: Boolean!) on FIELD | FRAGMENT_SPREAD | INLINE_FRAGMENT
        "Directs the executor to skip this field or fragment when the if argument is true."
        directive @skip(if: Boolean!) on FIELD | FRAGMENT_SPREAD | INLINE_FRAGMENT
        "Marks an element as deprecated with an optional reason."
        directive @deprecated(reason: String = "No longer supported") on FIELD_DEFINITION | ARGUMENT_DEFINITION | INPUT_FIELD_DEFINITION | ENUM_VALUE
        "Exposes a URL that specifies the behavior of this scalar."
        directive @specifiedBy(url: String!) on SCALAR
        "Indicates an Input Object is a OneOf Input Object."
        directive @oneOf on INPUT_OBJECT
        type Query { x: String }
      `,
      'query.graphql': '{ x }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { x: 'str' },
    });
  });

  it('handles @defer(if: false) in queries without error', () => {
    const f = writeFiles({
      'schema.graphqls': `
        directive @defer(if: Boolean, label: String) on FRAGMENT_SPREAD | INLINE_FRAGMENT
        type Query { x: String, y: Int }
      `,
      'query.graphql': '{ x ... @defer(if: false) { y } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { x: 'str', y: 2 },
    });
  });

  it('handles @defer(if: true) and returns complete data', () => {
    const f = writeFiles({
      'schema.graphqls': `
        directive @defer(if: Boolean, label: String) on FRAGMENT_SPREAD | INLINE_FRAGMENT
        type Query { x: String, y: Int }
      `,
      'query.graphql': '{ x ... @defer(if: true) { y } }',
    });
    const result = run(f['schema.graphqls'], f['query.graphql']);
    assert.deepStrictEqual(result, {
      data: { x: 'str', y: 2 },
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
