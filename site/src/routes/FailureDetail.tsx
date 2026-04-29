import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TestCaseHistoryChart } from '../components/TestCaseHistoryChart';
import { CopyButton } from '../components/CopyButton';
import { CodePane } from '../components/CodePane';
import { LabeledField } from '../components/LabeledField';
import { PassRateBar } from '../components/PassRateBar';
import {
  useCorpusArtifacts,
  useImpl,
  useImpls,
  useResultLookup,
  useRunOrLatest,
  useRunTestCaseOutcomes,
  useTestCaseHistory,
} from '../repository/hooks';
import type { Impl, Result, Run } from '../repository/types';
import type {
  TestCaseOutcome,
  TestCaseOutcomeStatus,
} from '../lib/testCaseOutcomes';
import type { CorpusArtifact, CorpusArtifacts } from '../lib/corpusArtifacts';
import { NotFound } from './NotFound';

export function FailureDetail() {
  const { name, runId, testCaseId } = useParams();
  const impls = useImpls();
  const impl = useImpl(name ?? '');
  const runQuery = useRunOrLatest(runId);
  const result = useResultLookup(runQuery.data?.id, name, testCaseId);
  const history = useTestCaseHistory(name, testCaseId);
  const runOutcomes = useRunTestCaseOutcomes(runQuery.data, testCaseId);

  if (!name) {
    return <NotFound message="Missing impl name." />;
  }
  if (!testCaseId) {
    return <NotFound message="Missing test case id." />;
  }

  const loading =
    impls.isLoading ||
    impl.isLoading ||
    runQuery.isLoading ||
    result.isLoading ||
    history.isLoading ||
    runOutcomes.isLoading;

  if (loading) return <div className="loading">Loading…</div>;

  if (
    impls.isError ||
    impl.isError ||
    runQuery.isError ||
    result.isError ||
    history.isError ||
    runOutcomes.isError
  ) {
    return <NotFound message="Failed to load failure data." fallbacks={[]} />;
  }

  const known = (impls.data ?? []).some((i) => i.id === name);
  if (!known) {
    return <NotFound message={`Unknown impl: ${name}`} />;
  }

  if (runId && !runQuery.data) {
    return (
      <NotFound
        message="That run isn't in the index."
        fallbacks={[
          {
            label: 'View this impl in the latest run',
            to: `/impl/${encodeURIComponent(name)}`,
          },
        ]}
      />
    );
  }

  if (!impl.data || !runQuery.data) {
    return <NotFound message="No data for this impl." />;
  }

  if (!result.data) {
    return (
      <NotFound
        message="That test did not fail for this implementation in this run."
        fallbacks={[
          {
            label: 'View this impl failures',
            to: `${implHref(runId, name)}/failures`,
          },
          {
            label: 'View this impl summary',
            to: implHref(runId, name),
          },
        ]}
      />
    );
  }

  return (
    <FailureDetailView
      impl={impl.data}
      impls={impls.data ?? []}
      run={runQuery.data}
      runId={runId}
      result={result.data}
      history={history.data ?? []}
      runOutcomes={runOutcomes.data ?? []}
      testCaseId={testCaseId}
    />
  );
}

interface FailureDetailViewProps {
  impl: Impl;
  impls: Impl[];
  run: Run;
  runId: string | undefined;
  result: Result;
  history: TestCaseOutcome[];
  runOutcomes: TestCaseOutcome[];
  testCaseId: string;
}

function FailureDetailView({
  impl,
  impls,
  run,
  runId,
  result,
  history,
  runOutcomes,
  testCaseId,
}: FailureDetailViewProps) {
  const artifacts = useCorpusArtifacts(testCaseId);
  const implById = new Map(impls.map((i) => [i.id, i]));
  const reference = implById.get(run.referenceImplId);
  const failureListHref = `${implHref(runId, impl.id)}/failures`;
  const historySummary = summarizeOutcomes(history);
  // "All results for this test" covers every non-reference impl. The
  // summary counts the whole pool (so "not scored" reflects impls that
  // fell out / were excluded upstream); the table only renders scored
  // rows so the unscored ones don't clutter the list.
  const allImplOutcomes = runOutcomes.filter(
    (outcome) => outcome.implId !== run.referenceImplId,
  );
  const peerSummary = summarizeOutcomes(allImplOutcomes);
  const peerOutcomes = allImplOutcomes
    .filter((outcome) => isScoredStatus(outcome.status))
    .sort((a, b) => {
      const byStatus = statusOrder(a.status) - statusOrder(b.status);
      if (byStatus !== 0) return byStatus;
      return implLabel(implById, a.implId).localeCompare(
        implLabel(implById, b.implId),
      );
    });
  const failedRuns = history
    .filter((outcome) => outcome.status === 'fail' || outcome.status === 'error')
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="detail-page failure-detail-page">
      <Link className="back" to={failureListHref}>
        ← Back to failures
      </Link>

      <section className="card failure-detail-title-card">
        <div className="failure-detail-title-head">
          <StatusPill status={result.status} />
          <h2>{impl.name}</h2>
        </div>
        <div className="failure-detail-fields">
          <LabeledField label="Test Case" mono>{testCaseId}</LabeledField>
          <LabeledField label="Run" mono>{run.id}</LabeledField>
          <LabeledField label="Timestamp" bold={false}>
            {formatTimestamp(run.timestamp)}
          </LabeledField>
        </div>
      </section>

      <div className="failure-response-grid">
        <ResponseSection
          title="Expected Response"
          subtitle={
            <>
              {reference?.name ?? run.referenceImplId}
              <span className="reference-pill inline-pill">Reference</span>
            </>
          }
          header="Expected"
          hasValue={hasResultField(result, 'expected')}
          value={result.expected}
          empty="No reference response was captured for this result."
        />
        <ResponseSection
          title="Actual Response"
          subtitle={impl.name}
          header="Actual"
          hasValue={hasResultField(result, 'actual')}
          value={result.actual}
          empty="No actual response was captured for this result."
          extra={<ErrorOrStderrBlock result={result} />}
        />
      </div>

      <TestInputSection
        loading={artifacts.isLoading}
        error={artifacts.isError}
        artifacts={artifacts.data ?? null}
      />

      <div className="history-layout">
        <section className="card detail-section-card failure-history-card chart-card">
          <div className="detail-section-header">
            <h3>History</h3>
            <p>{formatRateSummary(historySummary, 'scored runs')}</p>
          </div>
          <RateSummary summary={historySummary} />
          <div className="chart-container">
            <TestCaseHistoryChart history={history} />
          </div>
        </section>
        <div className="runs-history-slot">
          <FailureRunsTable
            runs={failedRuns}
            currentRunId={run.id}
            implId={impl.id}
            testCaseId={testCaseId}
          />
        </div>
      </div>

      <section className="card detail-section-card failure-peer-card">
        <div className="detail-section-header">
          <h3>All Results For This Test</h3>
          <p>{formatPeerRateSummary(peerSummary)}</p>
        </div>
        <RateSummary summary={peerSummary} />
        <PeerOutcomeTable
          outcomes={peerOutcomes}
          implById={implById}
          runId={runId}
          testCaseId={testCaseId}
          currentImplId={impl.id}
        />
      </section>
    </div>
  );
}

function TestInputSection({
  loading,
  error,
  artifacts,
}: {
  loading: boolean;
  error: boolean;
  artifacts: CorpusArtifacts | null;
}) {
  return (
    <section
      className="card detail-section-card failure-inputs-card"
      data-testid="failure-test-input"
    >
      <div className="detail-section-header">
        <h3>Test Input</h3>
        <p>Schema, query, and variables used in this test</p>
      </div>
      <div className="failure-inputs-body">
        {loading && (
          <div className="failure-response-empty">Loading test input…</div>
        )}
        {error && !loading && (
          <div className="failure-response-empty">
            Failed to load test input from the repository.
          </div>
        )}
        {!loading && !error && artifacts && (
          <>
            <ArtifactBlock label="Schema" language="graphql" artifact={artifacts.schema} />
            <ArtifactBlock label="Query" language="graphql" artifact={artifacts.query} />
            {artifacts.variables ? (
              <ArtifactBlock
                label="Variables"
                language="json"
                artifact={artifacts.variables}
              />
            ) : (
              <div className="failure-artifact-empty">
                No variables for this test case.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ArtifactBlock({
  label,
  language,
  artifact,
}: {
  label: string;
  language: 'graphql' | 'json';
  artifact: CorpusArtifact;
}) {
  return (
    <CodePane
      header={label}
      text={artifact.text}
      language={language}
      scrollable
      actions={
        <CopyButton
          text={artifact.text}
          label={`Copy ${label.toLowerCase()}`}
          title={`Copy ${label.toLowerCase()}`}
        />
      }
    />
  );
}

function ResponseSection({
  title,
  subtitle,
  header,
  hasValue,
  value,
  empty,
  extra,
}: {
  title: string;
  // Free-form — usually "graphql-java" + optional inline pill, so accepts
  // arbitrary nodes rather than a plain string.
  subtitle: ReactNode;
  header: string;
  hasValue: boolean;
  value: unknown;
  empty: string;
  extra?: ReactNode;
}) {
  const text = hasValue ? JSON.stringify(value, null, 2) : '';
  return (
    <section className="card detail-section-card failure-response-card">
      <div className="detail-section-header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="failure-response-body">
        {hasValue ? (
          <CodePane
            header={header}
            text={text}
            language="json"
            scrollable
            actions={
              <CopyButton
                text={text}
                label={`Copy ${header.toLowerCase()} response`}
                title={`Copy ${header.toLowerCase()} response`}
              />
            }
          />
        ) : (
          <div className="failure-response-empty">{empty}</div>
        )}
        {extra}
      </div>
    </section>
  );
}

// Mirrors the dashboard's reference/impl-row presentation: big percentage,
// small stats subtext, full-width bar — stacked rather than a 3-column row.
// Uses the shared `PassRateBar` so tone thresholds stay in sync.
function RateSummary({ summary }: { summary: OutcomeSummary }) {
  const pct = summary.passPct;
  return (
    <div className="failure-rate-summary">
      <div className="pass-rate-value">
        {pct == null ? 'n/a' : `${pct.toFixed(1)}%`}
      </div>
      <div className="pass-rate-meta">
        {summary.passed} passed · {summary.failed} failed
        {summary.unscored > 0 ? ` · ${summary.unscored} not scored` : ''}
      </div>
      <div className="full-width-bar">
        <PassRateBar passPct={pct ?? 0} />
      </div>
    </div>
  );
}

// Table of per-run failures for this (impl × test case), used alongside the
// history chart. Mirrors the layout of ImplDetail's "Other Runs" table
// (sticky header, scrollable body, clickable rows, current-row highlight) so
// both pages feel consistent.
function FailureRunsTable({
  runs,
  currentRunId,
  implId,
  testCaseId,
}: {
  runs: TestCaseOutcome[];
  currentRunId: string;
  implId: string;
  testCaseId: string;
}) {
  const rows = runs.slice(0, RECENT_RUNS_LIMIT);
  return (
    <section className="card detail-section-card runs-history-card">
      <div className="detail-section-header">
        <h3>Failed Runs</h3>
        <p>
          {rows.length === 0
            ? 'No failures recorded for this test.'
            : `${rows.length} ${rows.length === 1 ? 'run' : 'runs'} with failures`}
        </p>
      </div>
      {rows.length > 0 && (
        <div className="runs-history-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th className="runs-history-rate-col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <FailureRunsRow
                  key={r.runId}
                  outcome={r}
                  implId={implId}
                  testCaseId={testCaseId}
                  isCurrent={r.runId === currentRunId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FailureRunsRow({
  outcome,
  implId,
  testCaseId,
  isCurrent,
}: {
  outcome: TestCaseOutcome;
  implId: string;
  testCaseId: string;
  isCurrent: boolean;
}) {
  const navigate = useNavigate();
  const href = `/runs/${encodeURIComponent(outcome.runId)}/impl/${encodeURIComponent(
    implId,
  )}/failures/${encodeURIComponent(testCaseId)}`;

  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    navigate(href);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(href);
    }
  };

  return (
    <tr
      className={`runs-history-row${isCurrent ? ' is-current' : ''}`}
      tabIndex={0}
      role="link"
      aria-current={isCurrent ? 'page' : undefined}
      aria-label={`View failure from ${formatTimestamp(outcome.timestamp)}`}
      data-testid={`failure-runs-row-${outcome.runId}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td>{formatCompactTimestamp(outcome.timestamp)}</td>
      <td className="runs-history-rate-col">
        <StatusPill status={outcome.status} />
      </td>
    </tr>
  );
}

function PeerOutcomeTable({
  outcomes,
  implById,
  runId,
  testCaseId,
  currentImplId,
}: {
  outcomes: TestCaseOutcome[];
  implById: Map<string, Impl>;
  runId: string | undefined;
  testCaseId: string;
  currentImplId: string;
}) {
  if (outcomes.length === 0) {
    return (
      <div className="empty failure-peer-empty">
        No scored implementations ran this test.
      </div>
    );
  }
  return (
    <div className="failure-peer-table-wrap">
      <table className="failure-peer-table">
        <thead>
          <tr>
            <th>Implementation</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map((outcome) => {
            const isCurrent = outcome.implId === currentImplId;
            return (
              <tr
                key={outcome.implId}
                className={isCurrent ? 'is-current' : undefined}
                aria-current={isCurrent ? 'true' : undefined}
              >
                <td>
                  {isCurrent ? (
                    <span className="failure-peer-current-label">
                      {implLabel(implById, outcome.implId)}
                    </span>
                  ) : (
                    <Link to={peerOutcomeHref(runId, outcome, testCaseId)}>
                      {implLabel(implById, outcome.implId)}
                    </Link>
                  )}
                </td>
                <td>
                  <StatusPill status={outcome.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Shows the driver's error message, or — when there's no error message —
// falls back to stderr. Never both: `stderr` is usually a verbose dump of
// the same information already summarised by `error`. Absent both → null.
function ErrorOrStderrBlock({ result }: { result: Result }) {
  if (result.error) return <TextBlock label="error" text={result.error} />;
  if (result.stderr) return <TextBlock label="stderr" text={result.stderr} />;
  return null;
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="failure-extra-block">
      <div className="detail-label">{label}</div>
      <pre className="detail-pre">{text}</pre>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: Result['status'] | TestCaseOutcomeStatus;
}) {
  return (
    <span className={`status-pill status-pill-${status}`}>
      {formatOutcome(status)}
    </span>
  );
}

interface OutcomeSummary {
  passed: number;
  failed: number;
  excluded: number;
  skipped: number;
  scored: number;
  passPct: number | null;
  unscored: number;
}

function summarizeOutcomes(outcomes: TestCaseOutcome[]): OutcomeSummary {
  let passed = 0;
  let failed = 0;
  let excluded = 0;
  let skipped = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'pass') passed += 1;
    else if (outcome.status === 'excluded') excluded += 1;
    else if (outcome.status === 'skipped') skipped += 1;
    else failed += 1;
  }
  const scored = passed + failed;
  const unscored = excluded + skipped;
  return {
    passed,
    failed,
    excluded,
    skipped,
    scored,
    unscored,
    passPct: scored > 0 ? Math.round((passed / scored) * 1000) / 10 : null,
  };
}

function formatRateSummary(summary: OutcomeSummary, noun: string): string {
  if (summary.scored === 0) return `No ${noun} for this test case.`;
  return `${summary.passed} of ${summary.scored} ${noun} passed.`;
}

function formatPeerRateSummary(summary: OutcomeSummary): string {
  if (summary.scored === 0) return 'No other implementations ran this test.';
  return `${summary.passed} of ${summary.scored} implementations passed.`;
}

// Peer-table predicate: hide outcomes that didn't yield a pass/fail verdict.
function isScoredStatus(status: TestCaseOutcomeStatus): boolean {
  return status === 'pass' || status === 'fail' || status === 'error';
}

function implHref(runId: string | undefined, implId: string): string {
  const prefix = runId ? `/runs/${encodeURIComponent(runId)}` : '';
  return `${prefix}/impl/${encodeURIComponent(implId)}`;
}

function peerOutcomeHref(
  runId: string | undefined,
  outcome: TestCaseOutcome,
  testCaseId: string,
): string {
  const base = implHref(runId, outcome.implId);
  if (outcome.status === 'fail' || outcome.status === 'error') {
    return `${base}/failures/${encodeURIComponent(testCaseId)}`;
  }
  return base;
}

function implLabel(implById: Map<string, Impl>, implId: string): string {
  return implById.get(implId)?.name ?? implId;
}

function hasResultField(result: Result, field: 'expected' | 'actual'): boolean {
  return Object.prototype.hasOwnProperty.call(result, field);
}

function statusOrder(status: TestCaseOutcomeStatus): number {
  if (status === 'fail') return 0;
  if (status === 'error') return 1;
  if (status === 'pass') return 2;
  return 3;
}

function formatOutcome(status: Result['status'] | TestCaseOutcomeStatus): string {
  if (status === 'pass') return 'Passed';
  if (status === 'fail') return 'Failed';
  if (status === 'error') return 'Errored';
  // 'excluded' — 'skipped' never reaches here because the peer table filters
  // unscored outcomes upstream and no other call site uses that status.
  return 'Excluded';
}

function formatTimestamp(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString();
}

function formatCompactTimestamp(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Matches ImplDetail's cap. Kept in sync so the "Failed Runs" table on
// FailureDetail and the "Other Runs" table on ImplDetail show the same
// number of rows at most.
const RECENT_RUNS_LIMIT = 20;
