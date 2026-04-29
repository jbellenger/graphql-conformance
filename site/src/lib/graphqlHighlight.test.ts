import { describe, expect, it } from 'vitest';
import { tokenizeGraphql, type GraphqlToken } from './graphqlHighlight';

function nonPlain(tokens: GraphqlToken[]) {
  return tokens.filter((t) => t.kind !== 'plain');
}

describe('tokenizeGraphql', () => {
  it('classifies keywords, names, variables, directives, strings, and numbers', () => {
    const src = [
      'query Hello($id: ID! = "foo") @skip(if: true) {',
      '  field(x: 1.5) { nested }',
      '}',
    ].join('\n');
    const tokens = tokenizeGraphql(src);
    const kinds = nonPlain(tokens).map((t) => ({ kind: t.kind, text: t.text }));
    // Sanity-check the non-punctuation tokens surface as the right kind.
    expect(kinds).toContainEqual({ kind: 'keyword', text: 'query' });
    expect(kinds).toContainEqual({ kind: 'name', text: 'Hello' });
    expect(kinds).toContainEqual({ kind: 'variable', text: '$id' });
    expect(kinds).toContainEqual({ kind: 'name', text: 'ID' });
    expect(kinds).toContainEqual({ kind: 'string', text: '"foo"' });
    expect(kinds).toContainEqual({ kind: 'directive', text: '@skip' });
    expect(kinds).toContainEqual({ kind: 'boolean', text: 'true' });
    expect(kinds).toContainEqual({ kind: 'number', text: '1.5' });
    expect(kinds).toContainEqual({ kind: 'punctuation', text: '!' });
    expect(kinds).toContainEqual({ kind: 'punctuation', text: '{' });
  });

  it('tokenises SDL: keyword, type name, fields, punctuation', () => {
    const src = 'type Query { name: String! }';
    const kinds = nonPlain(tokenizeGraphql(src)).map((t) => t.kind);
    expect(kinds).toEqual([
      'keyword',     // type
      'name',        // Query
      'punctuation', // {
      'name',        // name
      'punctuation', // :
      'name',        // String
      'punctuation', // !
      'punctuation', // }
    ]);
  });

  it('handles block strings and line comments', () => {
    const src = '"""doc\nmulti"""\n# trailing comment\nquery Q { x }';
    const tokens = tokenizeGraphql(src);
    const kinds = nonPlain(tokens).map((t) => ({ kind: t.kind, text: t.text }));
    expect(kinds[0]).toEqual({ kind: 'string', text: '"""doc\nmulti"""' });
    expect(kinds[1]).toEqual({ kind: 'comment', text: '# trailing comment' });
  });

  it('reassembles the source text from tokens (no gaps)', () => {
    const src = 'query ($a: Int! = -3) { f(b: null) @d }';
    const tokens = tokenizeGraphql(src);
    expect(tokens.map((t) => t.text).join('')).toBe(src);
  });

  it('recognises spread operator and punctuation', () => {
    const src = 'fragment F on Type { ...G }';
    const kinds = nonPlain(tokenizeGraphql(src)).map((t) => ({
      kind: t.kind,
      text: t.text,
    }));
    expect(kinds).toContainEqual({ kind: 'keyword', text: 'fragment' });
    expect(kinds).toContainEqual({ kind: 'keyword', text: 'on' });
    expect(kinds).toContainEqual({ kind: 'punctuation', text: '...' });
  });

  it('treats null as its own kind', () => {
    const kinds = nonPlain(tokenizeGraphql('{ f(v: null) }')).map((t) => t.kind);
    expect(kinds).toContain('null');
  });
});
