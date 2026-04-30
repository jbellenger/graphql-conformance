import { useMemo, type ReactNode } from 'react';
import {
  buildJsonDiffRows,
  computeCharDiff,
  type DiffRow,
} from '../lib/jsonDiff';
import { renderPrismTokens, tokenizeLine } from '../lib/codeHighlight';

export interface JsonDiffProps {
  expected: unknown;
  actual: unknown;
  maxRows?: number;
  // Optional right-aligned action slots (typically CopyButtons) in each
  // column's header.
  expectedActions?: ReactNode;
  actualActions?: ReactNode;
}

// Two-column diff view for (expected, actual) JSON values. Long lines
// soft-wrap so the two columns stay aligned without introducing horizontal
// scroll.
export function JsonDiff({
  expected,
  actual,
  maxRows,
  expectedActions,
  actualActions,
}: JsonDiffProps) {
  const rows = useMemo(
    () => buildJsonDiffRows(expected, actual),
    [expected, actual],
  );
  const visible = maxRows == null ? rows : rows.slice(0, maxRows);

  return (
    <div className="json-diff" data-testid="json-diff">
      <div className="json-diff-headers">
        <div className="code-pane-header">
          <span>Expected</span>
          {expectedActions && (
            <div className="code-pane-actions">{expectedActions}</div>
          )}
        </div>
        <div className="code-pane-header">
          <span>Actual</span>
          {actualActions && (
            <div className="code-pane-actions">{actualActions}</div>
          )}
        </div>
      </div>
      <div className="json-diff-body">
        {visible.map((row, idx) => (
          <DiffRowPair key={idx} row={row} lineNumber={idx + 1} />
        ))}
      </div>
    </div>
  );
}

// Single-column view (e.g. for reference exclusion responses).
export interface JsonSingleProps {
  value: unknown;
  header?: string;
  maxRows?: number;
  // Right-aligned action slot in the header (typically a CopyButton).
  actions?: ReactNode;
}

export function JsonSingle({
  value,
  header = 'Response',
  maxRows,
  actions,
}: JsonSingleProps) {
  const lines = useMemo(
    () => JSON.stringify(value, null, 2).split('\n'),
    [value],
  );
  const visible = maxRows == null ? lines : lines.slice(0, maxRows);

  return (
    <div className="json-diff json-diff-single" data-testid="json-diff">
      <div className="json-diff-headers">
        <div className="code-pane-header">
          <span>{header}</span>
          {actions && <div className="code-pane-actions">{actions}</div>}
        </div>
      </div>
      <div className="json-diff-body json-diff-body-single">
        {visible.map((line, idx) => (
          <div key={idx} className="code-line diff-same">
            <span className="code-line-number" aria-hidden="true">
              {idx + 1}
            </span>
            <span className="code-line-content">
              {line ? renderPrismTokens(tokenizeLine(line, 'json')) : ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffRowPair({ row, lineNumber }: { row: DiffRow; lineNumber: number }) {
  const leftClass = classForSide(row, 'left');
  const rightClass = classForSide(row, 'right');
  return (
    <>
      <div className={`code-line ${leftClass}`}>
        <span className="code-line-number" aria-hidden="true">
          {lineNumber}
        </span>
        <span className="code-line-content">
          <DiffLineContent
            text={row.leftText}
            otherText={row.rightText}
            mode={row.mode === 'modified' ? 'modified-left' : row.mode}
          />
        </span>
      </div>
      <div className={`code-line ${rightClass}`}>
        <span className="code-line-number" aria-hidden="true">
          {lineNumber}
        </span>
        <span className="code-line-content">
          <DiffLineContent
            text={row.rightText}
            otherText={row.leftText}
            mode={row.mode === 'modified' ? 'modified-right' : row.mode}
          />
        </span>
      </div>
    </>
  );
}

function classForSide(row: DiffRow, side: 'left' | 'right'): string {
  if (row.mode === 'same') return 'diff-same';
  if (row.mode === 'modified') {
    return side === 'left' ? 'diff-removed' : 'diff-added';
  }
  if (row.mode === 'added') {
    return side === 'left' ? 'diff-empty' : 'diff-added';
  }
  return side === 'left' ? 'diff-removed' : 'diff-empty';
}

type LineMode = 'same' | 'added' | 'removed' | 'modified-left' | 'modified-right';

function DiffLineContent({
  text,
  otherText,
  mode,
}: {
  text: string;
  otherText: string;
  mode: LineMode;
}) {
  if (!text) return <>&nbsp;</>;
  if (mode === 'modified-left' || mode === 'modified-right') {
    const variant = mode === 'modified-left' ? 'removed' : 'added';
    const { prefix, changed, suffix } = computeCharDiff(text, otherText);
    return (
      <>
        {prefix && renderPrismTokens(tokenizeLine(prefix, 'json'), 'p-')}
        {changed && (
          <span className={`diff-char diff-char-${variant}`}>
            {renderPrismTokens(tokenizeLine(changed, 'json'), 'c-')}
          </span>
        )}
        {suffix && renderPrismTokens(tokenizeLine(suffix, 'json'), 's-')}
      </>
    );
  }
  return <>{renderPrismTokens(tokenizeLine(text, 'json'))}</>;
}
