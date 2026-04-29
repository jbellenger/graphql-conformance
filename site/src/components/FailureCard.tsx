import { Link } from 'react-router-dom';
import type { Result } from '../repository/types';
import { JsonDiff, JsonSingle } from './JsonDiff';
import { CopyButton } from './CopyButton';
import { LabeledField } from './LabeledField';

export interface FailureCardProps {
  result: Result;
  // Kept for callers that deep-link to a specific failure; currently just
  // surfaces as a `data-highlighted` attribute on the card so the scroll
  // target can be styled if needed.
  defaultExpanded?: boolean;
  detailTo?: string;
}

// Failure card rendered on the impl results page. Shows the test id, a
// Details link to the full failure page, and the expected/actual response
// panes. Deliberately does not truncate — callers that want a compressed
// view can paginate at the list level instead.
export function FailureCard({
  result,
  defaultExpanded = false,
  detailTo,
}: FailureCardProps) {
  return (
    <article
      className="failure-card"
      data-testid="failure-card"
      data-test-case-id={result.testCaseId}
      data-highlighted={defaultExpanded ? 'true' : undefined}
      role="group"
    >
      <header className="failure-card-header">
        <LabeledField label="Test" mono>{result.testCaseId}</LabeledField>
        {detailTo && (
          <div className="failure-card-actions">
            <Link
              className="failure-card-chip failure-card-detail-link"
              to={detailTo}
              aria-label={`View failure detail for ${result.testCaseId}`}
            >
              Details
            </Link>
          </div>
        )}
      </header>
      <div className="failure-card-body">
        <FailureBody result={result} />
      </div>
    </article>
  );
}

function FailureBody({ result }: { result: Result }) {
  const parts: React.ReactNode[] = [];

  if (result.expected != null && result.actual != null && result.status === 'fail') {
    parts.push(
      <div key="diff" className="failure-diff-block">
        <JsonDiff
          expected={result.expected}
          actual={result.actual}
          expectedActions={
            <CopyButton
              text={JSON.stringify(result.expected, null, 2)}
              label="Copy expected response"
              title="Copy expected response"
            />
          }
          actualActions={
            <CopyButton
              text={JSON.stringify(result.actual, null, 2)}
              label="Copy actual response"
              title="Copy actual response"
            />
          }
        />
      </div>,
    );
  } else if (result.actual != null) {
    parts.push(
      <div key="actual-single" className="failure-diff-block">
        <JsonSingle
          value={result.actual}
          header="Response"
          actions={
            <CopyButton
              text={JSON.stringify(result.actual, null, 2)}
              label="Copy response"
              title="Copy response"
            />
          }
        />
      </div>,
    );
  } else if (result.expected != null) {
    parts.push(
      <div key="expected-single" className="failure-diff-block">
        <JsonSingle
          value={result.expected}
          header="Expected"
          actions={
            <CopyButton
              text={JSON.stringify(result.expected, null, 2)}
              label="Copy expected response"
              title="Copy expected response"
            />
          }
        />
      </div>,
    );
  }

  // Prefer `error` (the driver's summarised message). Fall back to
  // `stderr` only when there is no error message at all — showing both
  // usually just duplicates the same information in two forms.
  if (result.error) {
    parts.push(
      <TextBlock key="error" label="error" text={result.error} />,
    );
  } else if (result.stderr) {
    parts.push(
      <TextBlock key="stderr" label="stderr" text={result.stderr} />,
    );
  }
  return <>{parts}</>;
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="failure-extra-block">
      <div className="detail-label">{label}</div>
      <pre className="detail-pre">{text}</pre>
    </div>
  );
}
