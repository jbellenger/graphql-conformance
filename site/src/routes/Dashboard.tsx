import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useImpls, useRunOrLatest } from '../repository/hooks';
import type { Impl, Run } from '../repository/types';
import { computeRunStats, formatRunStatsLine } from '../lib/runStats';
import { PassRateBar } from '../components/PassRateBar';
import { NotFound } from './NotFound';
import { implForRun } from '../lib/runImpl';

export function Dashboard() {
  const { runId } = useParams();
  const impls = useImpls();
  const runQuery = useRunOrLatest(runId);

  if (impls.isLoading || runQuery.isLoading) {
    return <div className="loading">Loading…</div>;
  }
  if (impls.isError || runQuery.isError) {
    return (
      <NotFound
        message="Failed to load conformance data."
        fallbacks={[]}
      />
    );
  }
  // runId present but the run doesn't exist → 404 with a latest-run fallback.
  if (runId && !runQuery.data) {
    return (
      <NotFound
        message="That run isn't in the index."
        fallbacks={[{ label: 'View the latest run', to: '/' }]}
      />
    );
  }
  if (!impls.data || !runQuery.data) {
    return (
      <NotFound
        message="No conformance data available yet."
        fallbacks={[]}
      />
    );
  }

  const run = runQuery.data;
  const isPinned = runId != null;
  const runImpls = impls.data.map((i) => implForRun(i, run));
  const reference = runImpls.find((i) => i.id === run.referenceImplId) ?? null;
  // Sort non-reference impls by pass rate descending; fall back to impl name
  // so the order is stable for ties.
  const others = runImpls
    .filter((i) => i.id !== run.referenceImplId)
    .slice()
    .sort((a, b) => {
      const aPct = computeRunStats(run, a).passPct;
      const bPct = computeRunStats(run, b).passPct;
      if (bPct !== aPct) return bPct - aPct;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="dashboard-layout">
      <div className="dashboard-sidebar">
        {reference && (
          <ReferenceCard impl={reference} run={run} runId={runId} />
        )}
        <LastRunCard run={run} isPinned={isPinned} />
      </div>
      <ResultsTable impls={others} run={run} runId={runId} />
    </div>
  );
}

function implHref(impl: Impl, runId: string | undefined): string {
  const implSegment = encodeURIComponent(impl.id);
  if (runId) return `/runs/${encodeURIComponent(runId)}/impl/${implSegment}`;
  return `/impl/${implSegment}`;
}

// Returns true when a mouse event should fall through (user wants the native
// anchor behavior: new-tab/new-window/download) or when the click landed on
// an interactive child that owns its own activation.
function shouldSkipRowActivation(e: MouseEvent): boolean {
  if (e.defaultPrevented) return true;
  if (e.button !== 0) return true; // non-primary mouse button
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return true;
  return (e.target as HTMLElement).closest('a, button') != null;
}

// Renders an impl version as a link to its source (GitHub/npm/etc.) when
// the data exposes versionUrl; plain text otherwise.
function VersionLink({
  impl,
  className,
}: {
  impl: Impl;
  className?: string;
}): ReactNode {
  if (!impl.version) return null;
  if (impl.versionUrl) {
    return (
      <a className={className} href={impl.versionUrl}>
        {impl.version}
      </a>
    );
  }
  return <span className={className}>{impl.version}</span>;
}

function ReferenceCard({
  impl,
  run,
  runId,
}: {
  impl: Impl;
  run: Run;
  runId: string | undefined;
}) {
  const stats = computeRunStats(run, impl);
  const navigate = useNavigate();
  const href = implHref(impl, runId);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (shouldSkipRowActivation(e)) return;
    navigate(href);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(href);
    }
  };
  return (
    <aside
      className="card reference-card"
      tabIndex={0}
      role="link"
      aria-label={`View ${impl.name} details`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className="reference-pill">Reference</span>
      <div className="reference-name">{impl.name}</div>
      {impl.version && (
        <div className="reference-version">
          <VersionLink impl={impl} />
        </div>
      )}
      <div className="reference-rate">{stats.passPct.toFixed(1)}%</div>
      <div className="reference-subtext">{formatRunStatsLine(stats)}</div>
      {stats.implFailed > 0 && (
        <div className="reference-note">
          Failing tests are excluded from conformance testing.
        </div>
      )}
      <div className="reference-bar">
        <PassRateBar passPct={stats.passPct} />
      </div>
    </aside>
  );
}

function LastRunCard({ run, isPinned }: { run: Run; isPinned: boolean }) {
  const label = isPinned ? 'Run' : 'Last run';
  const ariaLabel = isPinned ? 'Conformance run' : 'Last conformance run';
  return (
    <aside className="card last-run-card" aria-label={ariaLabel}>
      <span className="last-run-label">{label}</span>
      <div className="last-run-time">
        {new Date(run.timestamp).toLocaleString()}
      </div>
    </aside>
  );
}

function ResultsTable({
  impls,
  run,
  runId,
}: {
  impls: Impl[];
  run: Run;
  runId: string | undefined;
}) {
  if (impls.length === 0) {
    return <div className="card empty">No non-reference impls in this run.</div>;
  }
  return (
    <div className="card results-table-card">
      <table>
        <thead>
          <tr>
            <th>Implementation</th>
            <th className="pass-rate-cell">Pass rate</th>
          </tr>
        </thead>
        <tbody>
          {impls.map((impl) => (
            <ImplRow key={impl.id} impl={impl} run={run} runId={runId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImplRow({
  impl,
  run,
  runId,
}: {
  impl: Impl;
  run: Run;
  runId: string | undefined;
}) {
  const stats = computeRunStats(run, impl);
  const navigate = useNavigate();
  const href = implHref(impl, runId);
  const onClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (shouldSkipRowActivation(e)) return;
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
      className="dashboard-row"
      tabIndex={0}
      role="link"
      aria-label={`View ${impl.name} details`}
      data-testid={`dashboard-row-${impl.id}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <td>
        <div className="impl-name">{impl.name}</div>
        {impl.version && (
          <div className="pass-rate-meta">
            <VersionLink impl={impl} />
          </div>
        )}
      </td>
      <td className="pass-rate-cell">
        <div className="pass-rate-value">{stats.passPct.toFixed(1)}%</div>
        <div className="pass-rate-meta">{formatRunStatsLine(stats)}</div>
        <div className="full-width-bar">
          <PassRateBar passPct={stats.passPct} />
        </div>
      </td>
    </tr>
  );
}
