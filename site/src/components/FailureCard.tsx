import { useState, useRef, useEffect, type MouseEvent, type KeyboardEvent } from 'react';
import type { Result } from '../repository/types';
import { JsonDiff, JsonSingle } from './JsonDiff';
import { buildJsonDiffRows } from '../lib/jsonDiff';

const REPO_URL = 'https://github.com/jbellenger/graphql-conformance/blob/master';
const PREVIEW_ROWS = 4;
const STDERR_PREVIEW_LINES = 3;

export interface FailureCardProps {
  result: Result;
  defaultExpanded?: boolean;
}

// Decide whether a Result has enough content to warrant an expand toggle.
function canExpand(result: Result): boolean {
  if (result.expected != null && result.actual != null) {
    const rows = buildJsonDiffRows(result.expected, result.actual);
    if (rows.length > PREVIEW_ROWS) return true;
  }
  if (result.actual != null) {
    const lines = JSON.stringify(result.actual, null, 2).split('\n');
    if (lines.length > PREVIEW_ROWS) return true;
  }
  if (result.stderr) {
    const lines = result.stderr.trim().split('\n');
    if (lines.length > STDERR_PREVIEW_LINES) return true;
  }
  return false;
}

export function FailureCard({ result, defaultExpanded = false }: FailureCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const expandable = canExpand(result);
  const articleRef = useRef<HTMLElement>(null);

  // Keep local state aligned with route-driven defaultExpanded changes.
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const onToggle = () => {
    if (!expandable) return;
    setExpanded((v) => !v);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!expandable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  // Don't trigger expand when the user clicks within interactive content
  // (links, buttons). The copy button below stops propagation.
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('a, button')) return;
    onToggle();
  };

  const summary = getSummary(result);
  const classes = [
    'failure-card',
    expanded ? 'is-expanded' : '',
    expandable && !expanded ? 'is-collapsed' : '',
    expandable ? 'is-interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const maxRows = expanded ? undefined : PREVIEW_ROWS;

  return (
    <article
      ref={articleRef}
      className={classes}
      data-testid="failure-card"
      data-test-case-id={result.testCaseId}
      {...(expandable
        ? { tabIndex: 0, role: 'button', 'aria-expanded': expanded }
        : { role: 'group' })}
      onClick={onClick}
      onKeyDown={onKey}
    >
      <header className="failure-card-header">
        <div className="failure-card-heading">
          <div className="failure-card-label">Test</div>
          <div className="failure-card-title-row">
            <div className="failure-card-title mono">
              <TestKeyLink testKey={result.testCaseId} />
            </div>
            <CopyButton text={`corpus/${result.testCaseId}`} />
          </div>
        </div>
        {expandable && (
          <span className="failure-card-chip">
            {expanded ? 'Collapse' : 'Expand'}
          </span>
        )}
      </header>
      {summary && <div className="failure-card-summary">{summary}</div>}
      <div className="failure-card-body">
        <FailureBody result={result} maxRows={maxRows} />
      </div>
    </article>
  );
}

function getSummary(result: Result): string | null {
  if (result.error) return result.error;
  if (result.status === 'fail') return 'Output differs';
  if (result.status === 'excluded') return null; // response block speaks for itself
  return null;
}

function FailureBody({
  result,
  maxRows,
}: {
  result: Result;
  maxRows?: number;
}) {
  const parts: React.ReactNode[] = [];

  if (result.expected != null && result.actual != null && result.status === 'fail') {
    parts.push(
      <div key="diff" className="failure-diff-block">
        <JsonDiff expected={result.expected} actual={result.actual} maxRows={maxRows} />
      </div>,
    );
  } else if (result.actual != null) {
    parts.push(
      <div key="actual-single" className="failure-diff-block">
        <JsonSingle value={result.actual} header="Response" maxRows={maxRows} />
      </div>,
    );
  } else if (result.expected != null) {
    parts.push(
      <div key="expected-single" className="failure-diff-block">
        <JsonSingle value={result.expected} header="Expected" maxRows={maxRows} />
      </div>,
    );
  }

  if (result.stderr) {
    parts.push(
      <StderrBlock key="stderr" text={result.stderr} maxLines={maxRows == null ? undefined : STDERR_PREVIEW_LINES} />,
    );
  }
  return <>{parts}</>;
}

function StderrBlock({ text, maxLines }: { text: string; maxLines?: number }) {
  const lines = text.trim().split('\n');
  const visible = maxLines == null ? lines : lines.slice(0, maxLines);
  return (
    <div className="failure-extra-block">
      <div className="detail-label">stderr</div>
      <pre className="detail-pre">{visible.join('\n')}</pre>
    </div>
  );
}

function TestKeyLink({ testKey }: { testKey: string }) {
  const parts = testKey.split('/');
  const [schema, query, vars] = parts;
  return (
    <span className="failure-card-title-key">
      <span>corpus/</span>
      <a href={`${REPO_URL}/corpus/${schema}/schema.graphqls`}>{schema}</a>
      {'/'}
      <a href={`${REPO_URL}/corpus/${schema}/${query}/query.graphql`}>{query}</a>
      {vars && (
        <>
          {'/'}
          <a href={`${REPO_URL}/corpus/${schema}/${query}/${vars}/variables.json`}>{vars}</a>
        </>
      )}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; no-op
    }
  };

  return (
    <button
      type="button"
      className={`failure-card-copy${copied ? ' is-copied' : ''}`}
      aria-label={`Copy ${text}`}
      title="Copy test path"
      onClick={onClick}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M7 3.5A2.5 2.5 0 0 1 9.5 1h5A2.5 2.5 0 0 1 17 3.5v7A2.5 2.5 0 0 1 14.5 13h-5A2.5 2.5 0 0 1 7 10.5z" />
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H6v1.5h-.5A1 1 0 0 0 4.5 7.5v7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V14H13v.5A2.5 2.5 0 0 1 10.5 17h-5A2.5 2.5 0 0 1 3 14.5z" />
      </svg>
    </button>
  );
}
