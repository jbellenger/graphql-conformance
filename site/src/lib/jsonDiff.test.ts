import { describe, expect, it } from 'vitest';
import { buildJsonDiffRows, computeCharDiff } from './jsonDiff';

describe('buildJsonDiffRows', () => {
  it('produces all-same rows for identical inputs', () => {
    const rows = buildJsonDiffRows({ a: 1, b: 2 }, { a: 1, b: 2 });
    expect(rows.every((r) => r.mode === 'same')).toBe(true);
    expect(rows.map((r) => r.leftText).join('\n')).toBe(
      JSON.stringify({ a: 1, b: 2 }, null, 2),
    );
  });

  it('pairs a removed run with the following added run as modified rows', () => {
    const rows = buildJsonDiffRows(
      { data: { hello: 'world' } },
      { data: { hello: 'worlds' } },
    );
    // The line that changed is `"hello": "world"` → `"hello": "worlds"`.
    const mod = rows.find((r) => r.mode === 'modified');
    expect(mod).toBeTruthy();
    expect(mod?.leftText).toContain('world');
    expect(mod?.rightText).toContain('worlds');
  });

  it('marks a pure add as added (no removed counterpart)', () => {
    const rows = buildJsonDiffRows({ a: 1 }, { a: 1, b: 2 });
    const added = rows.filter((r) => r.mode === 'added');
    expect(added.length).toBe(1);
    expect(added[0].leftText).toBe('');
    expect(added[0].rightText).toContain('"b"');
  });

  it('marks a pure remove as removed', () => {
    const rows = buildJsonDiffRows({ a: 1, b: 2 }, { a: 1 });
    const removed = rows.filter((r) => r.mode === 'removed');
    expect(removed.length).toBe(1);
    expect(removed[0].rightText).toBe('');
    expect(removed[0].leftText).toContain('"b"');
  });
});

describe('computeCharDiff', () => {
  it('extracts the common prefix and suffix, leaving the middle changed', () => {
    const d = computeCharDiff('"hello"', '"hellos"');
    expect(d.prefix).toBe('"hello');
    expect(d.changed).toBe('');
    expect(d.suffix).toBe('"');
    // symmetric view:
    const d2 = computeCharDiff('"hellos"', '"hello"');
    expect(d2.prefix).toBe('"hello');
    expect(d2.changed).toBe('s');
    expect(d2.suffix).toBe('"');
  });

  it('handles fully-different strings with no common prefix/suffix', () => {
    const d = computeCharDiff('abc', 'xyz');
    expect(d.prefix).toBe('');
    expect(d.changed).toBe('abc');
    expect(d.suffix).toBe('');
  });

  it('handles identical strings', () => {
    const d = computeCharDiff('same', 'same');
    expect(d.prefix).toBe('same');
    expect(d.changed).toBe('');
    expect(d.suffix).toBe('');
  });
});
