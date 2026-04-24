// Tokenises a JSON text snippet (as produced by JSON.stringify(..., 2)) into
// typed segments for styled rendering. Mirrors the syntax classes used by the
// legacy render.js (json-key / json-string / json-number / json-boolean /
// json-null) but returns a data structure rather than HTML so consumers can
// render safely with React.

export type JsonTokenKind =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'plain';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN_RE =
  /"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function tokenizeJsonText(text: string): JsonToken[] {
  const out: JsonToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      out.push({ kind: 'plain', text: text.slice(cursor, start) });
    }
    const [lexeme] = match;
    out.push({ kind: classify(lexeme), text: lexeme });
    cursor = start + lexeme.length;
  }
  if (cursor < text.length) {
    out.push({ kind: 'plain', text: text.slice(cursor) });
  }
  return out;
}

function classify(lexeme: string): JsonTokenKind {
  if (lexeme === 'true' || lexeme === 'false') return 'boolean';
  if (lexeme === 'null') return 'null';
  if (lexeme.startsWith('"')) {
    return lexeme.endsWith(':') ? 'key' : 'string';
  }
  return 'number';
}

// Convenience: tokenise a full JSON value (pretty-printed at indent=2).
export function tokenizeJsonValue(value: unknown): JsonToken[] {
  return tokenizeJsonText(JSON.stringify(value, null, 2));
}
