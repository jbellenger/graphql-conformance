import { useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
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
  ImplRunResults,
  Result,
  Run,
} from '../repository/types';
import { HistoryChart } from '../components/HistoryChart';
import { FailureCard } from '../components/FailureCard';

export function ImplDetail() {
  const { name, testCaseId } = useParams();
  const impls = useImpls();
  const impl = useImpl(name ?? '');
  const latest = useLatestRun();
  const history = useImplHistory(name);
  const results = useResults({
    runId: latest.data?.id,
    implId: name,
  });

  const failuresRef = useRef<HTMLElement>(null);
  const hasScrolled = useRef(false);

  // Scroll to the failures section when the route includes /failures.
  // If a testCaseId is present, scroll to that specific card (whose
  // FailureCard component will open itself via defaultExpanded).
  useEffect(() => {
    if (hasScrolled.current) return;
    const ready =
      impls.data && impl.data && latest.data && results.data !== undefined;
    if (!ready) return;
    const path = window.location.hash;
    const wantsFailures = /\/failures/.test(path);
    if (!wantsFailures) return;

    requestAnimationFrame(() => {
      if (testCaseId) {
        const card = document.querySelector(
          `[data-test-case-id="${CSS.escape(testCaseId)}"]`,
        );
        if (card instanceof HTMLElement) {
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          card.focus?.();
          hasScrolled.current = true;
          return;
        }
      }
      failuresRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      hasScrolled.current = true;
    });
  }, [impls.data, impl.data, latest.data, results.data, testCaseId]);

  // Reset scroll memo when navigating between impls.
  useEffect(() => {
    hasScrolled.current = false;
  }, [name, testCaseId]);

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
  const summary = run.resultsByImpl[impl.id];
  const display = computeDisplay(run, summary);
  const isReference = impl.isReference;
  const failureHref = display.failed > 0 ? `#/impl/${impl.id}/failures` : null;
  const excludedHref =
    !isReference && display.excluded > 0
      ? `#/impl/${run.referenceImplId}/failures`
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
        <header className="detail-summary-header">
          <h2>
            {impl.name}
            {isReference && (
              <span className="reference-pill inline-pill">Reference</span>
            )}
          </h2>
        </header>
        <div className="detail-rate-row">
          <div className="detail-rate">{display.passPct.toFixed(1)}%</div>
          <div className="detail-subtext">
            {display.passed} / {display.total} passed
            {display.excluded > 0 && ` · ${display.excluded} excluded`}
            {display.failed > 0 && ` · ${display.failed} failed`}
            {display.errored > 0 && ` · ${display.errored} errored`}
          </div>
        </div>
        <div className="bar-container detail-bar">
          <div
            className={`bar-fill ${barClass(display.passPct)}`}
            style={{ width: `${display.passPct}%` }}
          />
        </div>
        <div className="detail-meta-grid">
          <MetaCard label="Run" value={formatTimestamp(run.timestamp)} />
          <MetaCard label="Total" value={display.total.toString()} />
          {!isReference && (
            <MetaCard
              label="Excluded"
              value={display.excluded.toString()}
              href={excludedHref}
            />
          )}
          <MetaCard
            label={isReference ? 'Failed' : 'Failed'}
            value={(display.failed + display.errored).toString()}
            href={failureHref}
            smiley={display.failed + display.errored === 0}
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

function MetaCard({
  label,
  value,
  href = null,
  mono = false,
  smiley = false,
}: {
  label: string;
  value: string;
  href?: string | null;
  mono?: boolean;
  smiley?: boolean;
}) {
  const inner = href ? <a href={href}>{value}</a> : <>{value}</>;
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

interface Display {
  total: number;
  passed: number;
  excluded: number;
  failed: number;
  errored: number;
  passPct: number;
}

function computeDisplay(run: Run, summary?: ImplRunResults): Display {
  const total = run.testCaseCount;
  const failed = summary?.failed ?? 0;
  const excluded = summary?.excluded ?? 0;
  const errored = summary?.errored ?? 0;
  const passed = Math.max(0, total - failed - excluded - errored);
  const passPct = total > 0 ? Math.round((passed / total) * 1000) / 10 : 100;
  return { total, passed, excluded, failed, errored, passPct };
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
