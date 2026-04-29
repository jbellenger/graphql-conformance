import { useMemo, type ReactNode } from 'react';
import { JsonTokens } from './JsonTokens';
import { GraphqlTokens } from './GraphqlTokens';
import { tokenizeJsonText } from '../lib/jsonHighlight';
import { tokenizeGraphql } from '../lib/graphqlHighlight';

export type CodeLanguage = 'json' | 'graphql';

export interface CodePaneProps {
  header: string;
  // Raw text to render. Callers pre-format as needed (e.g. pretty-print JSON
  // with JSON.stringify(value, null, 2)).
  text: string;
  language: CodeLanguage;
  // Truncates to the first N lines when set. Used by the collapsed preview
  // in FailureCard; full-page callers omit.
  maxRows?: number;
  // Caps the rendered height and scrolls when longer. Use for panes that
  // may be tall (full schemas, long queries) but would otherwise make the
  // page unwieldy.
  scrollable?: boolean;
  // Slot rendered on the right side of the header — typically a CopyButton.
  actions?: ReactNode;
}

// Shared code-rendering pane used by the failure detail page. Matches the
// visual treatment of JsonDiff's single-column view (border, uppercase
// header bar, tokenised rows) so the "expected/actual response" panes and
// the "test input" schema/query/variables panes look identical.
export function CodePane({
  header,
  text,
  language,
  maxRows,
  scrollable = false,
  actions,
}: CodePaneProps) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const visible = maxRows == null ? lines : lines.slice(0, maxRows);

  const classes = [
    'json-diff',
    'json-diff-single',
    'code-pane',
    scrollable ? 'json-diff-scrollable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-testid="code-pane" data-language={language}>
      <div className="json-diff-header code-pane-header">
        <span>{header}</span>
        {actions && <div className="code-pane-actions">{actions}</div>}
      </div>
      <div className="code-pane-body">
        {visible.map((line, idx) => (
          <div key={idx} className="json-diff-line diff-same">
            {line ? renderTokens(line, language) : ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderTokens(line: string, language: CodeLanguage) {
  if (language === 'graphql') {
    return <GraphqlTokens tokens={tokenizeGraphql(line)} />;
  }
  return <JsonTokens tokens={tokenizeJsonText(line)} />;
}
