import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useImpls, useLatestRun } from '../repository/hooks';
import type { Impl, Run } from '../repository/types';
import { computeRunStats, formatRunStatsLine } from '../lib/runStats';

export function Dashboard() {
  const impls = useImpls();
  const latest = useLatestRun();

  if (impls.isLoading || latest.isLoading) {
    return <div className="loading">Loading…</div>;
  }
  if (impls.isError || latest.isError) {
    return <div className="empty">Failed to load conformance data.</div>;
  }
  if (!impls.data || !latest.data) {
    return <div className="empty">No conformance data available yet.</div>;
  }

  const run = latest.data;
  const reference = impls.data.find((i) => i.id === run.referenceImplId) ?? null;
  // Sort non-reference impls by pass rate descending; fall back to impl name
  // so the order is stable for ties.
  const others = impls.data
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
        {reference && <ReferenceCard impl={reference} run={run} />}
        <LastRunCard run={run} />
      </div>
      <ResultsTable impls={others} run={run} />
    </div>
  );
}

function implHref(impl: Impl): string {
  return `/impl/${encodeURIComponent(impl.id)}`;
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

function ReferenceCard({ impl, run }: { impl: Impl; run: Run }) {
  const stats = computeRunStats(run, impl);
  const navigate = useNavigate();
  const href = implHref(impl);
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
      <div className="reference-bar">
        <PassRateBar passPct={stats.passPct} />
      </div>
    </aside>
  );
}

function LastRunCard({ run }: { run: Run }) {
  return (
    <aside className="card last-run-card" aria-label="Last conformance run">
      <span className="last-run-label">Last run</span>
      <div className="last-run-time">
        {new Date(run.timestamp).toLocaleString()}
      </div>
    </aside>
  );
}

function ResultsTable({ impls, run }: { impls: Impl[]; run: Run }) {
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
            <ImplRow key={impl.id} impl={impl} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImplRow({ impl, run }: { impl: Impl; run: Run }) {
  const stats = computeRunStats(run, impl);
  const navigate = useNavigate();
  const href = implHref(impl);
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
        <div className="pass-rate-meta">
          {stats.passed} / {stats.total} passed
        </div>
        <div className="full-width-bar">
          <PassRateBar passPct={stats.passPct} />
        </div>
      </td>
    </tr>
  );
}

function PassRateBar({ passPct }: { passPct: number }) {
  const tone = passPct >= 95 ? 'bar-pass' : passPct >= 50 ? 'bar-warn' : 'bar-fail';
  return (
    <div className="bar-container" aria-label={`${passPct.toFixed(1)}% passing`}>
      <div
        className={`bar-fill ${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, passPct))}%` }}
      />
    </div>
  );
}
