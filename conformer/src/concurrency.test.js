'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseConcurrency, runWithConcurrency } = require('./index');

describe('parseConcurrency', () => {
  it('returns null for empty/undefined', () => {
    assert.equal(parseConcurrency(undefined), null);
    assert.equal(parseConcurrency(null), null);
    assert.equal(parseConcurrency(''), null);
  });

  it('returns null for non-numeric or <1', () => {
    assert.equal(parseConcurrency('abc'), null);
    assert.equal(parseConcurrency('0'), null);
    assert.equal(parseConcurrency('-3'), null);
  });

  it('parses positive integers', () => {
    assert.equal(parseConcurrency('1'), 1);
    assert.equal(parseConcurrency('4'), 4);
    assert.equal(parseConcurrency(16), 16);
    assert.equal(parseConcurrency('3.9'), 3);
  });
});

describe('runWithConcurrency', () => {
  it('respects the concurrency limit and returns results in order', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    let active = 0;
    let peak = 0;
    const results = await runWithConcurrency(3, items, async (x) => {
      active += 1;
      if (active > peak) peak = active;
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return x.toUpperCase();
    });
    assert.equal(peak, 3);
    assert.deepStrictEqual(
      results.map((r) => r.value),
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    );
    assert.ok(results.every((r) => r.status === 'fulfilled'));
  });

  it('captures rejections without aborting other workers', async () => {
    const results = await runWithConcurrency(2, [1, 2, 3, 4], async (x) => {
      if (x % 2 === 0) throw new Error(`boom-${x}`);
      return x * 10;
    });
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].value, 10);
    assert.equal(results[1].status, 'rejected');
    assert.match(results[1].reason.message, /boom-2/);
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(results[2].value, 30);
    assert.equal(results[3].status, 'rejected');
    assert.match(results[3].reason.message, /boom-4/);
  });

  it('handles empty input', async () => {
    const results = await runWithConcurrency(4, [], async () => { throw new Error('nope'); });
    assert.deepStrictEqual(results, []);
  });

  it('caps effective concurrency at items.length', async () => {
    let active = 0;
    let peak = 0;
    await runWithConcurrency(100, ['x', 'y'], async () => {
      active += 1;
      if (active > peak) peak = active;
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    assert.equal(peak, 2);
  });
});
