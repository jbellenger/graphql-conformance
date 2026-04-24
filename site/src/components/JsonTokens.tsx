import type { JsonToken } from '../lib/jsonHighlight';

const CLASS_BY_KIND: Record<JsonToken['kind'], string> = {
  key: 'json-key',
  string: 'json-string',
  number: 'json-number',
  boolean: 'json-boolean',
  null: 'json-null',
  plain: 'json-plain',
};

// Renders an array of tokens as inline <span> elements.
export function JsonTokens({ tokens }: { tokens: JsonToken[] }) {
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
