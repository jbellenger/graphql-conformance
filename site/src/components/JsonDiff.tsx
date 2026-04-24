import { useMemo } from 'react';
import {
  buildJsonDiffRows,
  computeCharDiff,
  type DiffRow,
} from '../lib/jsonDiff';
import { tokenizeJsonText } from '../lib/jsonHighlight';
import { JsonTokens } from './JsonTokens';

export interface JsonDiffProps {
  expected: unknown;
  actual: unknown;
  maxRows?: number;
}

// Two-column diff view for (expected, actual) JSON values.
export function JsonDiff({ expected, actual, maxRows }: JsonDiffProps) {
  const rows = useMemo(
    () => buildJsonDiffRows(expected, actual),
    [expected, actual],
  );
  const visible = maxRows == null ? rows : rows.slice(0, maxRows);
  return (
    <div className="json-diff">
      <div className="json-diff-header">Expected</div>
      <div className="json-diff-header">Actual</div>
      {visible.map((row, idx) => (
        <DiffRowPair key={idx} row={row} />
      ))}
    </div>
  );
}

// Single-column view (e.g. for reference exclusion responses).
export interface JsonSingleProps {
  value: unknown;
  header?: string;
  maxRows?: number;
}

export function JsonSingle({
  value,
  header = 'Response',
  maxRows,
}: JsonSingleProps) {
  const lines = useMemo(
    () => JSON.stringify(value, null, 2).split('\n'),
    [value],
  );
  const visible = maxRows == null ? lines : lines.slice(0, maxRows);
  return (
    <div className="json-diff json-diff-single">
      <div className="json-diff-header">{header}</div>
      {visible.map((line, idx) => (
        <div key={idx} className="json-diff-line diff-same">
          {line ? <JsonTokens tokens={tokenizeJsonText(line)} /> : ' '}
        </div>
      ))}
    </div>
  );
}

function DiffRowPair({ row }: { row: DiffRow }) {
  const leftClass = classForSide(row, 'left');
  const rightClass = classForSide(row, 'right');
  return (
    <>
      <div className={`json-diff-line ${leftClass}`}>
        <DiffLineContent
          text={row.leftText}
          otherText={row.rightText}
          mode={row.mode === 'modified' ? 'modified-left' : row.mode}
        />
      </div>
      <div className={`json-diff-line ${rightClass}`}>
        <DiffLineContent
          text={row.rightText}
          otherText={row.leftText}
          mode={row.mode === 'modified' ? 'modified-right' : row.mode}
        />
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
        {prefix && <JsonTokens tokens={tokenizeJsonText(prefix)} />}
        {changed && (
          <span className={`diff-char diff-char-${variant}`}>
            <JsonTokens tokens={tokenizeJsonText(changed)} />
          </span>
        )}
        {suffix && <JsonTokens tokens={tokenizeJsonText(suffix)} />}
      </>
    );
  }
  return <JsonTokens tokens={tokenizeJsonText(text)} />;
}
