import { useMemo, type ReactNode } from 'react';
import { Highlight } from 'prism-react-renderer';
import type { CodeLanguage } from '../lib/codeHighlight';

export type { CodeLanguage } from '../lib/codeHighlight';

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

// Empty theme — styling comes from CSS (`.token.keyword`, `.token.string`,
// etc.) so it matches the rest of the site's palette without inline styles.
const EMPTY_THEME = { plain: {}, styles: [] };

// Read-only code pane with Prism syntax highlighting and a line-number
// gutter. Long lines soft-wrap (no horizontal scrollbars). Used for the
// schema/query/variables panes on the failure detail page and for the
// single-column response view.
export function CodePane({
  header,
  text,
  language,
  maxRows,
  scrollable = false,
  actions,
}: CodePaneProps) {
  const displayText = useMemo(() => {
    if (maxRows == null) return text;
    return text.split('\n').slice(0, maxRows).join('\n');
  }, [text, maxRows]);

  const bodyClass = [
    'code-pane-body',
    scrollable ? 'is-scrollable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="code-pane" data-testid="code-pane" data-language={language}>
      <div className="code-pane-header">
        <span>{header}</span>
        {actions && <div className="code-pane-actions">{actions}</div>}
      </div>
      <div className={bodyClass}>
        <Highlight code={displayText} language={language} theme={EMPTY_THEME}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <pre className="code-pre" aria-label={header}>
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line });
                return (
                  <div
                    {...lineProps}
                    key={i}
                    className={`code-line ${lineProps.className ?? ''}`.trim()}
                  >
                    <span className="code-line-number" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="code-line-content">
                      {line.map((token, key) => {
                        const tokenProps = getTokenProps({ token });
                        return <span {...tokenProps} key={key} />;
                      })}
                    </span>
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}
