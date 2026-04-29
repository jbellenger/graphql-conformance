import type { GraphqlToken } from '../lib/graphqlHighlight';

const CLASS_BY_KIND: Record<GraphqlToken['kind'], string> = {
  keyword: 'gql-keyword',
  name: 'gql-name',
  variable: 'gql-variable',
  directive: 'gql-directive',
  string: 'gql-string',
  number: 'gql-number',
  boolean: 'gql-boolean',
  null: 'gql-null',
  comment: 'gql-comment',
  punctuation: 'gql-punctuation',
  plain: 'gql-plain',
};

// Renders an array of GraphQL tokens as inline <span> elements, preserving
// whitespace and newlines from the source.
export function GraphqlTokens({ tokens }: { tokens: GraphqlToken[] }) {
  return (
    <>
      {tokens.map((t, idx) => {
        if (t.kind === 'plain') return <span key={idx}>{t.text}</span>;
        return (
          <span key={idx} className={CLASS_BY_KIND[t.kind]}>
            {t.text}
          </span>
        );
      })}
    </>
  );
}
