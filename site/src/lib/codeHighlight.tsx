import { Prism } from 'prism-react-renderer';
import type { ReactNode } from 'react';

export type CodeLanguage = 'graphql' | 'json';

// Renders the raw prismjs token stream (strings interleaved with Token objects,
// where a Token's `content` may itself be a nested stream) as React nodes.
// Used by the diff view, which tokenises one physical line at a time so that
// per-side character-level highlighting can wrap a substring of the line.
export function renderPrismTokens(
  tokens: (string | Prism.Token)[],
  keyPrefix = '',
): ReactNode {
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}${idx}`;
    if (typeof token === 'string') return token;
    const className = tokenClassName(token);
    const content = Array.isArray(token.content)
      ? renderPrismTokens(token.content, `${key}-`)
      : typeof token.content === 'string'
        ? token.content
        : renderPrismTokens([token.content], `${key}-`);
    return (
      <span key={key} className={className}>
        {content}
      </span>
    );
  });
}

function tokenClassName(token: Prism.Token): string {
  const typeClass = `token ${token.type}`;
  const alias = token.alias;
  if (!alias) return typeClass;
  if (Array.isArray(alias)) return `${typeClass} ${alias.join(' ')}`;
  return `${typeClass} ${alias}`;
}

export function tokenizeLine(
  text: string,
  language: CodeLanguage,
): (string | Prism.Token)[] {
  const grammar = Prism.languages[language];
  if (!grammar) return [text];
  return Prism.tokenize(text, grammar);
}
