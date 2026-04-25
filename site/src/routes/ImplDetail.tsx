import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  useImpl,
  useImplHistory,
  useImpls,
  useLatestRun,
  useResults,
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

export function ImplDetail() {
  const { name, testCaseId } = useParams();
  const location = useLocation();
  const impls = useImpls();
  const impl = useImpl(name ?? '');
  const latest = useLatestRun();
  const history = useImplHistory(name);
  const results = useResults({
    runId: latest.data?.id,
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
      impls.data && impl.data && latest.data && results.data !== undefined;
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
    latest.data,
    results.data,
    testCaseId,
    location.pathname,
  ]);

  if (!name) {
    return <div className="empty">Missing impl name.</div>;
  }

  const loading =
    impls.isLoading ||
    impl.isLoading ||
    latest.isLoading ||
    history.isLoading ||
    results.isLoading;

  if (loading) return <div className="loading">Loading…</div>;

  // Validate the name against the allowlist; otherwise 404.
  const known = (impls.data ?? []).some((i) => i.id === name);
  if (!known) {
    return (
      <div className="empty">
        <p>Unknown impl: {name}</p>
        <p>
          <Link to="/">Back to dashboard</Link>
        </p>
      </div>
    );
  }

  if (!impl.data || !latest.data) {
    return <div className="empty">No data for this impl.</div>;
  }

  return (
    <ImplDetailView
      impl={impl.data}
      run={latest.data}
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
  history: ImplHistoryPoint[];
  results: Result[];
  highlightedTestCaseId?: string;
  failuresRef: React.RefObject<HTMLElement>;
}

function ImplDetailView({
  impl,
  run,
  history,
  results,
  highlightedTestCaseId,
  failuresRef,
}: ImplDetailViewProps) {
  const stats = computeRunStats(run, impl);
  const isReference = impl.id === run.referenceImplId;
  const failureTo = stats.implFailed > 0 ? `/impl/${impl.id}/failures` : null;
  const excludedTo =
    !isReference && stats.corpusExcluded > 0
      ? `/impl/${run.referenceImplId}/failures`
      : null;

  const byStatus = useMemo(() => {
    const sorted = [...results].sort((a, b) =>
      a.testCaseId.localeCompare(b.testCaseId),
    );
    return sorted;
  }, [results]);

  const hasItems = byStatus.length > 0;

  return (
    <div className="detail-page">
      <Link className="back" to="/">
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
        <section className="card detail-section-card chart-card">
          <div className="detail-section-header">
            <h3>History</h3>
            <p>Pass rate over recorded runs.</p>
          </div>
          <div className="chart-container">
            <HistoryChart history={history} />
          </div>
        </section>
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
              {byStatus.length === 1 ? '' : 's'} in the latest run.
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
