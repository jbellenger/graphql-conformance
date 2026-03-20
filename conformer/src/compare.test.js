'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deepEqual, unorderedEqual, normalizeHarnessError, compareResults } = require('./compare');

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

describe('unorderedEqual', () => {
  it('same-order objects', () => {
    assert.equal(unorderedEqual({ a: 1, b: 2 }, { a: 1, b: 2 }), true);
  });

  it('different-order objects', () => {
    assert.equal(unorderedEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  });

  it('nested different-order', () => {
    assert.equal(
      unorderedEqual({ x: { b: 2, a: 1 } }, { x: { a: 1, b: 2 } }),
      true
    );
  });

  it('different values', () => {
    assert.equal(unorderedEqual({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
  });

  it('null vs absent', () => {
    assert.equal(unorderedEqual({ a: null }, {}), false);
    assert.equal(unorderedEqual({}, { a: null }), false);
  });

  it('arrays with different element order', () => {
    assert.equal(unorderedEqual([1, 2, 3], [3, 2, 1]), false);
  });
});

describe('compareResults', () => {
  it('both successful and matching', () => {
    const a = { result: { data: { x: 1 } } };
    const b = { result: { data: { x: 1 } } };
    assert.deepStrictEqual(compareResults(a, b), { matches: true });
  });

  it('same data, different key order', () => {
    const a = { result: { data: { a: 1, b: 2 } } };
    const b = { result: { data: { b: 2, a: 1 } } };
    assert.deepStrictEqual(compareResults(a, b), { matches: true });
  });

  it('both successful but different data', () => {
    const a = { result: { data: { x: 1 } } };
    const b = { result: { data: { x: 2 } } };
    assert.deepStrictEqual(compareResults(a, b), { matches: false });
  });

  it('reference errored', () => {
    const a = { error: 'timeout' };
    const b = { result: { data: { x: 1 } } };
    assert.deepStrictEqual(compareResults(a, b), { matches: false });
  });

  it('conformant errored', () => {
    const a = { result: { data: { x: 1 } } };
    const b = { error: 'crash' };
    assert.deepStrictEqual(compareResults(a, b), { matches: false });
  });

  it('matching harness errors match', () => {
    const a = { error: 'process exited with code 1' };
    const b = { error: 'process exited with code 1' };
    assert.deepStrictEqual(compareResults(a, b), { matches: true });
  });

  it('different exit codes do not match', () => {
    const a = { error: 'process exited with code 1' };
    const b = { error: 'process exited with code 2' };
    assert.deepStrictEqual(compareResults(a, b), { matches: false });
  });

  it('timeout vs crash do not match', () => {
    const a = { error: 'timeout' };
    const b = { error: 'spawn foo ENOENT' };
    assert.deepStrictEqual(compareResults(a, b), { matches: false });
  });

  it('invalid JSON vs exit do not match', () => {
    const a = { error: 'invalid JSON output' };
    const b = { error: 'process exited with code 1' };
    assert.deepStrictEqual(compareResults(a, b), { matches: false });
  });
});

describe('normalizeHarnessError', () => {
  it('normalizes timeout', () => {
    assert.deepStrictEqual(normalizeHarnessError({ error: 'timeout' }), { kind: 'timeout' });
  });

  it('normalizes process exits', () => {
    assert.deepStrictEqual(
      normalizeHarnessError({ error: 'process exited with code 17' }),
      { kind: 'exit', code: 17 },
    );
  });

  it('normalizes invalid JSON output', () => {
    assert.deepStrictEqual(
      normalizeHarnessError({ error: 'invalid JSON output' }),
      { kind: 'invalid-json' },
    );
  });
});
