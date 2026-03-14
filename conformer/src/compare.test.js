'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deepEqual, exactEqual } = require('./compare');

describe('deepEqual', () => {
  it('identical primitives', () => {
    assert.equal(deepEqual(1, 1), true);
    assert.equal(deepEqual('a', 'a'), true);
    assert.equal(deepEqual(true, true), true);
    assert.equal(deepEqual(null, null), true);
  });

  it('different primitives', () => {
    assert.equal(deepEqual(1, 2), false);
    assert.equal(deepEqual('a', 'b'), false);
    assert.equal(deepEqual(true, false), false);
  });

  it('type mismatches', () => {
    assert.equal(deepEqual(1, '1'), false);
    assert.equal(deepEqual(null, undefined), false);
    assert.equal(deepEqual(null, 0), false);
    assert.equal(deepEqual([], {}), false);
  });

  it('null vs absent key', () => {
    assert.equal(deepEqual({ a: null }, {}), false);
    assert.equal(deepEqual({}, { a: null }), false);
  });

  it('identical objects', () => {
    assert.equal(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
  });

  it('different key order', () => {
    assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
  });

  it('nested objects', () => {
    assert.equal(
      deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }),
      true
    );
    assert.equal(
      deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }),
      false
    );
  });

  it('arrays same order', () => {
    assert.equal(deepEqual([1, 2, 3], [1, 2, 3]), true);
  });

  it('arrays different order', () => {
    assert.equal(deepEqual([1, 2, 3], [3, 2, 1]), false);
  });

  it('arrays different length', () => {
    assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  });

  it('empty objects', () => {
    assert.equal(deepEqual({}, {}), true);
  });

  it('empty arrays', () => {
    assert.equal(deepEqual([], []), true);
  });

  it('complex nested structure', () => {
    const a = { data: { hero: { name: 'str', friends: [{ name: 'str' }, { name: 'str' }] } } };
    const b = { data: { hero: { name: 'str', friends: [{ name: 'str' }, { name: 'str' }] } } };
    assert.equal(deepEqual(a, b), true);
  });

  it('null inside object vs absent', () => {
    const a = { data: { hero: null } };
    const b = { data: {} };
    assert.equal(deepEqual(a, b), false);
  });
});

describe('exactEqual', () => {
  it('both successful and matching', () => {
    const a = { result: { data: { x: 1 } } };
    const b = { result: { data: { x: 1 } } };
    assert.equal(exactEqual(a, b), true);
  });

  it('both successful but different', () => {
    const a = { result: { data: { x: 1 } } };
    const b = { result: { data: { x: 2 } } };
    assert.equal(exactEqual(a, b), false);
  });

  it('reference errored', () => {
    const a = { error: 'timeout' };
    const b = { result: { data: { x: 1 } } };
    assert.equal(exactEqual(a, b), false);
  });

  it('conformant errored', () => {
    const a = { result: { data: { x: 1 } } };
    const b = { error: 'crash' };
    assert.equal(exactEqual(a, b), false);
  });

  it('both errored', () => {
    const a = { error: 'timeout' };
    const b = { error: 'crash' };
    assert.equal(exactEqual(a, b), false);
  });
});
