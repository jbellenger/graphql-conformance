import { describe, expect, it } from 'vitest';
import { tokenizeJsonText, tokenizeJsonValue } from './jsonHighlight';

describe('tokenizeJsonText', () => {
  it('classifies keys, strings, numbers, booleans, and null', () => {
    const tokens = tokenizeJsonText('{"a": 1, "b": "hi", "c": true, "d": null}');
    const byKind = tokens
      .filter((t) => t.kind !== 'plain')
      .map((t) => ({ kind: t.kind, text: t.text }));
    expect(byKind).toEqual([
      { kind: 'key', text: '"a":' },
      { kind: 'number', text: '1' },
      { kind: 'key', text: '"b":' },
      { kind: 'string', text: '"hi"' },
      { kind: 'key', text: '"c":' },
      { kind: 'boolean', text: 'true' },
      { kind: 'key', text: '"d":' },
      { kind: 'null', text: 'null' },
    ]);
  });

  it('does not leave gaps — plain + token segments reconstruct input', () => {
    const input = '{\n  "name": "Alice",\n  "age": 30\n}';
    const tokens = tokenizeJsonText(input);
    expect(tokens.map((t) => t.text).join('')).toBe(input);
  });

  it('handles negative numbers and exponents', () => {
    const tokens = tokenizeJsonText('[-1, 2.5, 1e3, -3.14e-2]');
    const nums = tokens.filter((t) => t.kind === 'number').map((t) => t.text);
    expect(nums).toEqual(['-1', '2.5', '1e3', '-3.14e-2']);
  });

  it('tokenizeJsonValue pretty-prints then tokenises', () => {
    const tokens = tokenizeJsonValue({ a: 1 });
    // Reconstructed text matches pretty-printed JSON
    const flat = tokens.map((t) => t.text).join('');
    expect(flat).toBe('{\n  "a": 1\n}');
  });
});
