'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSchema, execute, parse } = require('graphql');
const { fieldResolver } = require('./index');

async function exec(sdl, query) {
  const schema = buildSchema(sdl);
  const document = parse(query);
  const result = await execute({ schema, document, fieldResolver });
  // Normalize null-prototype objects from graphql-js via JSON round-trip
  return JSON.parse(JSON.stringify(result));
}

describe('wiring spec', () => {
  it('every Int field returns 2', async () => {
    const result = await exec('type Query { x: Int }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: 2 } });
  });

  it('every Float field returns 3.14', async () => {
    const result = await exec('type Query { x: Float }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: 3.14 } });
  });

  it('every String field returns "str"', async () => {
    const result = await exec('type Query { x: String }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: 'str' } });
  });

  it('every Boolean field returns true', async () => {
    const result = await exec('type Query { x: Boolean }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: true } });
  });

  it('every ID field returns "id"', async () => {
    const result = await exec('type Query { x: ID }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: 'id' } });
  });

  it('every nullable field is returned as non-null', async () => {
    const result = await exec('type Query { x: String }', '{ x }');
    assert.notEqual(result.data.x, null);
  });

  it('every list field returns exactly 2 items', async () => {
    const result = await exec('type Query { x: [String] }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: ['str', 'str'] } });
  });

  it('every enum field returns its first declared value', async () => {
    const result = await exec(
      'enum Color { RED GREEN BLUE } type Query { x: Color }',
      '{ x }'
    );
    assert.deepStrictEqual(result, { data: { x: 'RED' } });
  });

  it('every union is resolved as the alphabetically first member type', async () => {
    const result = await exec(
      'type Dog { bark: String } type Cat { meow: String } union Pet = Dog | Cat type Query { x: Pet }',
      '{ x { ... on Cat { meow } ... on Dog { bark } } }'
    );
    assert.deepStrictEqual(result, { data: { x: { meow: 'str' } } });
  });

  it('every interface is resolved as the alphabetically last implementing type', async () => {
    const result = await exec(
      'interface Node { id: ID } type Alpha implements Node { id: ID, a: Int } type Zeta implements Node { id: ID, z: Int } type Query { x: Node }',
      '{ x { id ... on Alpha { a } ... on Zeta { z } } }'
    );
    assert.deepStrictEqual(result, { data: { x: { id: 'id', z: 2 } } });
  });

  it('nested list of objects returns 2 items each with resolved fields', async () => {
    const result = await exec(
      'type Item { name: String } type Query { items: [Item] }',
      '{ items { name } }'
    );
    assert.deepStrictEqual(result, {
      data: { items: [{ name: 'str' }, { name: 'str' }] },
    });
  });

  it('non-null wrapper does not change the resolved value', async () => {
    const result = await exec('type Query { x: String! }', '{ x }');
    assert.deepStrictEqual(result, { data: { x: 'str' } });
  });
});
