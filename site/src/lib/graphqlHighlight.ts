// Minimal GraphQL syntax tokeniser for the failure detail page. Handles the
// subset the corpus emits (SDL + executable docs): keywords, names, variables,
// directives, strings (incl. block strings), numbers, comments, punctuation.
// Not a full GraphQL parser — just enough for styled read-only rendering.

export type GraphqlTokenKind =
  | 'keyword'
  | 'name'
  | 'variable'
  | 'directive'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'comment'
  | 'punctuation'
  | 'plain';

export interface GraphqlToken {
  kind: GraphqlTokenKind;
  text: string;
}

// Ordered alternation: block strings before regular strings, comments before
// punctuation, etc. Each alternative matches a whole lexeme; gaps (whitespace,
// commas as-insignificant-separator) fall through as `plain`.
const TOKEN_RE = new RegExp(
  [
    /#[^\n]*/.source, // comment
    /"""[\s\S]*?"""/.source, // block string
    /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"/.source, // string
    /\$[A-Za-z_][A-Za-z0-9_]*/.source, // variable
    /@[A-Za-z_][A-Za-z0-9_]*/.source, // directive
    /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.source, // number
    /[A-Za-z_][A-Za-z0-9_]*/.source, // name / keyword
    /\.{3}/.source, // spread
    /[{}()[\]:,=|!?&]/.source, // punctuation
  ].join('|'),
  'g',
);

const KEYWORDS = new Set([
  'directive',
  'enum',
  'extend',
  'fragment',
  'implements',
  'input',
  'interface',
  'mutation',
  'on',
  'query',
  'repeatable',
  'scalar',
  'schema',
  'subscription',
  'type',
  'union',
]);

export function tokenizeGraphql(text: string): GraphqlToken[] {
  const out: GraphqlToken[] = [];
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

function classify(lexeme: string): GraphqlTokenKind {
  const c = lexeme[0];
  if (c === '#') return 'comment';
  if (c === '"') return 'string';
  if (c === '$') return 'variable';
  if (c === '@') return 'directive';
  if (c === '-' || (c >= '0' && c <= '9')) return 'number';
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
    if (lexeme === 'true' || lexeme === 'false') return 'boolean';
    if (lexeme === 'null') return 'null';
    if (KEYWORDS.has(lexeme)) return 'keyword';
    return 'name';
  }
  return 'punctuation';
}
