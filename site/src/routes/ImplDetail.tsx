import type { KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  useImpl,
  useImplHistory,
  useImpls,
  useResults,
  useRunOrLatest,
} from '../repository/hooks';
import type {
  Impl,
  ImplHistoryPoint,
  Result,
  Run,
} from '../repository/types';
import { HistoryChart } from '../components/HistoryChart';
import { FailureCard } from '../components/FailureCard';
import { computeRunStats, formatRunStatsLine } from '../lib/runStats';
import { NotFound } from './NotFound';

const RECENT_RUNS_LIMIT = 20;

export function ImplDetail() {
  const { name, testCaseId, runId } = useParams();
  const location = useLocation();
  const impls = useImpls();
  const impl = useImpl(name ?? '');
  const runQuery = useRunOrLatest(runId);
  const history = useImplHistory(name);
  const results = useResults({
    runId: runQuery.data?.id,
    implId: name,
  });

  const failuresRef = useRef<HTMLElement>(null);

  // Scroll to the failures section when the route includes /failures. Fires
  // any time the pathname becomes /failures (including in-page navigation
  // like clicking the "Failed" meta card when already on the impl page) or
  // when the results shard finishes loading. If a testCaseId is present,
  // scroll to that specific card instead of the section header.
  useEffect(() => {
    const ready =
      impls.data && impl.data && runQuery.data && results.data !== undefined;
    if (!ready) return;
    if (!/\/failures/.test(location.pathname)) return;

    requestAnimationFrame(() => {
      if (testCaseId) {
        const card = document.querySelector(
          `[data-test-case-id="${CSS.escape(testCaseId)}"]`,
        );
        if (card instanceof HTMLElement) {
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          card.focus?.();
          return;
        }
      }
      failuresRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, [
    impls.data,
    impl.data,
    runQuery.data,
    results.data,
    testCaseId,
    location.pathname,
  ]);

  if (!name) {
    return <NotFound message="Missing impl name." />;
  }

  const loading =
    impls.isLoading ||
    impl.isLoading ||
    runQuery.isLoading ||
    history.isLoading ||
    results.isLoading;

  if (loading) return <div className="loading">Loading…</div>;

  // Validate the name against the allowlist; otherwise 404.
  const known = (impls.data ?? []).some((i) => i.id === name);
  if (!known) {
    return <NotFound message={`Unknown impl: ${name}`} />;
  }

  // runId present but the run doesn't exist → 404 with an impl-latest fallback
  // that keeps the user on this impl.
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

  return (
    <ImplDetailView
      impl={impl.data}
      run={runQuery.data}
      runId={runId}
      history={history.data ?? []}
      results={results.data ?? []}
      highlightedTestCaseId={testCaseId}
      failuresRef={failuresRef}
    />
  );
}

interface ImplDetailViewProps {
  impl: Impl;
  run: Run;
  runId: string | undefined;
  history: ImplHistoryPoint[];
  results: Result[];
  highlightedTestCaseId?: string;
  failuresRef: React.RefObject<HTMLElement>;
}

// Prefix that preserves the pinned-run URL segment when one is present; empty
// otherwise. All in-app navigation from the detail page should use this so a
// user reading a permalinked run stays on that run as they click around.
function runPrefix(runId: string | undefined): string {
  return runId ? `/runs/${encodeURIComponent(runId)}` : '';
}

function ImplDetailView({
  impl,
  run,
  runId,
  history,
  results,
  highlightedTestCaseId,
  failuresRef,
}: ImplDetailViewProps) {
  const stats = computeRunStats(run, impl);
  const isReference = impl.id === run.referenceImplId;
  const prefix = runPrefix(runId);
  const failureTo =
    stats.implFailed > 0 ? `${prefix}/impl/${impl.id}/failures` : null;
  const excludedTo =
    !isReference && stats.corpusExcluded > 0
      ? `${prefix}/impl/${run.referenceImplId}/failures`
      : null;
  const summaryHref = prefix || '/';

  const byStatus = useMemo(() => {
    const sorted = [...results].sort((a, b) =>
      a.testCaseId.localeCompare(b.testCaseId),
    );
    return sorted;
  }, [results]);

  const hasItems = byStatus.length > 0;

  return (
    <div className="detail-page">
      <Link className="back" to={summaryHref}>
        ← Back to summary
      </Link>

      <section className="card detail-summary-card">
        <div className="detail-summary-header">
          <h2>
            {impl.name}
            {isReference && (
              <span className="reference-pill inline-pill">Reference</span>
            )}
          </h2>
        </div>
        <div className="detail-rate-row">
          <div className="detail-rate">{stats.passPct.toFixed(1)}%</div>
          <div className="detail-subtext">{formatRunStatsLine(stats)}</div>
          {isReference && stats.implFailed > 0 && (
            <div className="reference-note">
              Failing tests are excluded from conformance testing.
            </div>
          )}
          {stats.falloutAfter != null && (
            <div className="reference-note">
              Testing was aborted after {stats.implFailed} failures.
            </div>
          )}
        </div>
        <div className="bar-container detail-bar">
          <div
            className={`bar-fill ${barClass(stats.passPct)}`}
            style={{ width: `${stats.passPct}%` }}
          />
        </div>
        <div className="detail-meta-grid">
          <MetaCard label="Run" value={formatTimestamp(run.timestamp)} />
          <MetaCard label="Total" value={stats.total.toString()} />
          {!isReference && (
            <MetaCard
              label="Excluded"
              value={stats.corpusExcluded.toString()}
              to={excludedTo}
            />
          )}
          <MetaCard
            label="Failed"
            value={stats.implFailed.toString()}
            to={failureTo}
            smiley={stats.implFailed === 0}
          />
          <MetaCard
            label="Version"
            value={impl.version ?? 'unknown'}
            href={impl.versionUrl ?? null}
            mono
          />
        </div>
      </section>

      {history.length > 1 && (
        <div className="history-layout">
          <section className="card detail-section-card chart-card">
            <div className="detail-section-header">
              <h3>History</h3>
              <p>Pass rate over recorded runs.</p>
            </div>
            <div className="chart-container">
              <HistoryChart history={history} />
            </div>
          </section>
          {/* Slot wrapper: the inner card is absolutely-positioned so its
              intrinsic height doesn't drive the grid row. The row height is
              set by the chart card; the runs-history card stretches to fill
              and scrolls its body when the row list exceeds that height. */}
          <div className="runs-history-slot">
            <RunsHistoryTable
              history={history}
              currentRunId={run.id}
              implId={impl.id}
            />
          </div>
        </div>
      )}

      {hasItems ? (
        <section
          id="failures"
          ref={failuresRef}
          className="card detail-section-card"
        >
          <div className="detail-section-header">
            <h3>{isReference ? 'Excluded Tests' : 'Failing Tests'}</h3>
            <p>
              {byStatus.length}{' '}
              {isReference ? 'exclusion' : 'failure'}
              {byStatus.length === 1 ? '' : 's'} in this run.
            </p>
          </div>
          <div className="failure-list">
            {byStatus.map((r) => (
              <FailureCard
                key={r.id}
                result={r}
                defaultExpanded={r.testCaseId === highlightedTestCaseId}
              />
            ))}
          </div>
        </section>
      ) : (
        <ZeroFailures />
      )}
    </div>
  );
}

interface MetaCardProps {
  label: string;
  value: string;
  // Internal (react-router) route; rendered as a <Link> so navigation stays
  // in-app and useLocation observers fire.
  to?: string | null;
  // External URL; rendered as a plain anchor (e.g. a GitHub release page).
  href?: string | null;
  mono?: boolean;
  smiley?: boolean;
}

function MetaCard({
  label,
  value,
  to = null,
  href = null,
  mono = false,
  smiley = false,
}: MetaCardProps) {
  let inner: React.ReactNode = value;
  if (to) inner = <Link to={to}>{value}</Link>;
  else if (href) inner = <a href={href}>{value}</a>;
  return (
    <div className="detail-meta-card">
      <span>{label}</span>
      <strong className={mono ? 'mono' : undefined}>{inner}</strong>
      {smiley && (
        <img
          src={`${import.meta.env.BASE_URL}icons/happy-face.svg`}
          className="detail-meta-emote"
          alt=""
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function RunsHistoryTable({
  history,
  currentRunId,
  implId,
}: {
  history: ImplHistoryPoint[];
  currentRunId: string;
  implId: string;
}) {
  const rows = history.slice(0, RECENT_RUNS_LIMIT);
  return (
    <section className="card detail-section-card runs-history-card">
      <div className="detail-section-header">
        <h3>Other runs</h3>
        <p>Last {rows.length} {rows.length === 1 ? 'run' : 'runs'}</p>
      </div>
      <div className="runs-history-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th className="runs-history-rate-col">Pass rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <RunsHistoryRow
                key={h.runId}
                point={h}
                implId={implId}
                isCurrent={h.runId === currentRunId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunsHistoryRow({
  point,
  implId,
  isCurrent,
}: {
  point: ImplHistoryPoint;
  implId: string;
  isCurrent: boolean;
}) {
  const navigate = useNavigate();
  const href = `/runs/${encodeURIComponent(point.runId)}/impl/${encodeURIComponent(implId)}`;
  const passPct =
    point.total > 0
      ? Math.round((point.passed / point.total) * 1000) / 10
      : 100;

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
      aria-label={`View ${formatTimestamp(point.timestamp)} run`}
      data-testid={`runs-history-row-${point.runId}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td>{formatCompactTimestamp(point.timestamp)}</td>
      <td className="runs-history-rate-col mono">{passPct.toFixed(1)}%</td>
    </tr>
  );
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

function ZeroFailures() {
  return (
    <section className="card detail-section-card zero-failures-card">
      <div className="zero-failures-art" aria-hidden="true">
        <img
          src={`${import.meta.env.BASE_URL}icons/happy-face.svg`}
          className="zero-failures-art-img"
          alt=""
        />
      </div>
      <div className="zero-failures-copy">
        <h3>No failures in this run</h3>
        <p>All tests passed.</p>
      </div>
    </section>
  );
}

function barClass(pct: number): string {
  if (pct >= 95) return 'bar-pass';
  if (pct >= 80) return 'bar-warn';
  return 'bar-fail';
}

function formatTimestamp(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return d.toLocaleString();
}
