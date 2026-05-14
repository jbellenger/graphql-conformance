'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyIncrementalMerge, parseMultipartMixed, parseContentType } = require('./execute');

function part(body) {
  return { headers: 'Content-Type: application/json', body };
}

describe('parseContentType', () => {
  it('extracts type and boundary', () => {
    const result = parseContentType('multipart/mixed; boundary=abc123');
    assert.equal(result.type, 'multipart/mixed');
    assert.equal(result.params.boundary, 'abc123');
  });

  it('strips surrounding quotes from params', () => {
    const result = parseContentType('multipart/mixed; boundary="x-y-z"');
    assert.equal(result.params.boundary, 'x-y-z');
  });
});

describe('parseMultipartMixed', () => {
  it('splits multipart body into JSON parts', () => {
    const boundary = 'abc';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      '{"data":{"hero":null},"hasNext":true}',
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      '{"incremental":[{"path":["hero"],"data":{"name":"str"}}],"hasNext":false}',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const parts = parseMultipartMixed(Buffer.from(body), boundary);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0].body, { data: { hero: null }, hasNext: true });
    assert.deepEqual(parts[1].body.incremental, [{ path: ['hero'], data: { name: 'str' } }]);
  });

  it('handles LF-only line endings', () => {
    const boundary = 'b';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      '{"data":{}}',
      `--${boundary}--`,
      '',
    ].join('\n');
    const parts = parseMultipartMixed(Buffer.from(body), boundary);
    assert.equal(parts.length, 1);
    assert.deepEqual(parts[0].body, { data: {} });
  });
});

describe('applyIncrementalMerge', () => {
  it('returns initial data unchanged when no follow-up parts', () => {
    const initial = { data: { a: 1 }, hasNext: false };
    const merged = applyIncrementalMerge(initial, []);
    assert.deepEqual(merged, { data: { a: 1 } });
  });

  it('strips hasNext/pending/incremental/completed from result', () => {
    const initial = {
      data: { a: 1 },
      hasNext: true,
      pending: [{ id: '0', path: ['a'] }],
      incremental: [],
      completed: [],
    };
    const merged = applyIncrementalMerge(initial, []);
    assert.deepEqual(merged, { data: { a: 1 } });
  });

  it('merges a deferred patch using direct path', () => {
    const initial = { data: { hero: { name: 'str' } }, hasNext: true };
    const parts = [part({
      incremental: [{ path: ['hero'], data: { friend: { name: 'str' } } }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged, {
      data: { hero: { name: 'str', friend: { name: 'str' } } },
    });
  });

  it('resolves pending id → path from initial', () => {
    const initial = {
      data: { hero: { name: 'str' } },
      pending: [{ id: '0', path: ['hero'] }],
      hasNext: true,
    };
    const parts = [part({
      incremental: [{ id: '0', data: { friend: { name: 'str' } } }],
      completed: [{ id: '0' }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.hero.friend, { name: 'str' });
  });

  it('applies incremental entries that arrive on the initial part', () => {
    const initial = {
      data: {
        objectField: { value: 'str' },
        listOfObjects: [
          { value: 'str', number: 2 },
          { value: 'str', number: 2 },
        ],
      },
      pending: [{ id: '2', path: ['objectField'] }],
      incremental: [{ id: '2', data: { number: 2 } }],
      completed: [{ id: '2' }],
      hasNext: false,
    };
    const merged = applyIncrementalMerge(initial, []);
    assert.deepEqual(merged.data.objectField, { value: 'str', number: 2 });
  });

  it('resolves pending id → path from a subsequent part', () => {
    const initial = { data: { hero: {} }, hasNext: true };
    const parts = [
      part({ pending: [{ id: '7', path: ['hero'] }], hasNext: true }),
      part({ incremental: [{ id: '7', data: { name: 'str' } }], hasNext: false }),
    ];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.hero, { name: 'str' });
  });

  it('applies subPath when present', () => {
    const initial = {
      data: { hero: { friend: {} } },
      pending: [{ id: '0', path: ['hero'] }],
      hasNext: true,
    };
    const parts = [part({
      incremental: [{ id: '0', subPath: ['friend'], data: { name: 'str' } }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.hero.friend, { name: 'str' });
  });

  // P2 regression: two @defer patches at the same path sharing a nested object key
  // must deep-merge their fields, not overwrite. Without deep-merge, `friend` ends up
  // with only `value` (the later patch wins).
  it('deep-merges overlapping deferred patches at same path', () => {
    const initial = { data: { hero: {} }, hasNext: true };
    const parts = [
      part({
        incremental: [{ path: ['hero'], data: { friend: { name: 'str' } } }],
        hasNext: true,
      }),
      part({
        incremental: [{ path: ['hero'], data: { friend: { value: 2 } } }],
        hasNext: false,
      }),
    ];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.hero.friend, { name: 'str', value: 2 });
  });

  // P1 regression: @stream patches carry `path: [..., insertionIndex]`. Naively navigating
  // the full path looks for the not-yet-created array element at `insertionIndex` and
  // silently drops the chunk. The merger must treat the last segment as an insertion index
  // and append items to the array at `path[0..-1]`.
  it('appends streamed items, treating path last segment as insertion index', () => {
    const initial = { data: { friends: [{ name: 'a' }] }, hasNext: true };
    const parts = [part({
      incremental: [{ path: ['friends', 1], items: [{ name: 'b' }, { name: 'c' }] }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.friends, [
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ]);
  });

  it('supports streamed items arriving in multiple chunks', () => {
    const initial = { data: { friends: [{ n: 0 }] }, hasNext: true };
    const parts = [
      part({ incremental: [{ path: ['friends', 1], items: [{ n: 1 }] }], hasNext: true }),
      part({ incremental: [{ path: ['friends', 2], items: [{ n: 2 }, { n: 3 }] }], hasNext: false }),
    ];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.friends, [{ n: 0 }, { n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('streamed items via pending id use base path (no insertion index)', () => {
    const initial = {
      data: { friends: [{ n: 0 }] },
      pending: [{ id: '0', path: ['friends'] }],
      hasNext: true,
    };
    const parts = [part({
      incremental: [{ id: '0', subPath: [1], items: [{ n: 1 }, { n: 2 }] }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.friends, [{ n: 0 }, { n: 1 }, { n: 2 }]);
  });

  // Hot Chocolate emits `{"data": null, "items": [...]}` for @stream patches.
  // Naively checking `data` first (even when null) overwrites the target slot.
  // The merger must treat this as an items-only patch.
  it('treats entries with items+data:null as items patches (no slot overwrite)', () => {
    const initial = { data: { friends: [{ name: 'a' }] }, hasNext: true };
    const parts = [part({
      incremental: [{ data: null, items: [{ name: 'b' }], path: ['friends', 1] }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.friends, [{ name: 'a' }, { name: 'b' }]);
  });

  // Some impls (Hot Chocolate) emit `items` patches via pending id with no
  // `subPath`; the resolved path points directly at the target list. The merger
  // must append to that list rather than treating the last segment as an index.
  it('appends streamed items when resolved path points at a list (no index segment)', () => {
    const initial = {
      data: { friends: [{ n: 0 }] },
      pending: [{ id: '0', path: ['friends'] }],
      hasNext: true,
    };
    const parts = [part({
      incremental: [{ id: '0', items: [{ n: 1 }, { n: 2 }] }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.data.friends, [{ n: 0 }, { n: 1 }, { n: 2 }]);
  });

  it('aggregates errors from initial, chunk top-level, and incremental entries', () => {
    const initial = {
      data: { hero: null },
      errors: [{ message: 'initial error' }],
      hasNext: true,
    };
    const parts = [
      part({
        errors: [{ message: 'chunk error' }],
        incremental: [{
          path: ['hero'],
          data: { name: 'str' },
          errors: [{ message: 'incremental error' }],
        }],
        hasNext: false,
      }),
    ];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.errors.map((e) => e.message), [
      'initial error',
      'chunk error',
      'incremental error',
    ]);
  });

  it('drops errors key when no errors surfaced', () => {
    const initial = { data: { a: 1 }, errors: [], hasNext: false };
    const merged = applyIncrementalMerge(initial, []);
    assert.ok(!('errors' in merged));
  });

  it('preserves extensions from initial and merges from chunks', () => {
    const initial = {
      data: { a: 1 },
      extensions: { tracing: { start: 1 } },
      hasNext: true,
    };
    const parts = [part({
      extensions: { tracing: { end: 2 }, custom: true },
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged.extensions, { tracing: { end: 2 }, custom: true });
  });

  it('ignores parts with no body (e.g. malformed)', () => {
    const initial = { data: { a: 1 }, hasNext: true };
    const parts = [{ headers: 'x', body: null }, part({ hasNext: false })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.deepEqual(merged, { data: { a: 1 } });
  });

  it('replaces nested scalar with patched value', () => {
    const initial = { data: { hero: { name: null } }, hasNext: true };
    const parts = [part({
      incremental: [{ path: ['hero'], data: { name: 'str' } }],
      hasNext: false,
    })];
    const merged = applyIncrementalMerge(initial, parts);
    assert.equal(merged.data.hero.name, 'str');
  });
});
