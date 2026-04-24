import type { KeyboardEvent, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useImpls, useLatestRun } from '../repository/hooks';
import type { Impl, ImplRunResults, Run } from '../repository/types';

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
      const aPct = computeDisplay(run, run.resultsByImpl[a.id]).passPct;
      const bPct = computeDisplay(run, run.resultsByImpl[b.id]).passPct;
      if (bPct !== aPct) return bPct - aPct;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="dashboard-layout">
      {reference && <ReferenceCard impl={reference} run={run} />}
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

function ReferenceCard({ impl, run }: { impl: Impl; run: Run }) {
  const summary = run.resultsByImpl[impl.id];
  const display = computeDisplay(run, summary);
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
      <div>
        <Link className="reference-link" to={href} tabIndex={-1}>
          {impl.name}
        </Link>
      </div>
      <div className="reference-rate">{display.passPct.toFixed(1)}%</div>
      <div className="reference-subtext">
        {display.passed} / {display.total} passed
        {display.excluded > 0 && ` (excluded ${display.excluded})`}
      </div>
      <div className="reference-bar">
        <PassRateBar passPct={display.passPct} />
      </div>
      <div className="reference-meta">
        {impl.version && (
          <div>
            <span>Version</span>
            {impl.versionUrl ? (
              <a href={impl.versionUrl}>{impl.version}</a>
            ) : (
              <>{impl.version}</>
            )}
          </div>
        )}
        <div>
          <span>Last run</span>
          {new Date(run.timestamp).toLocaleString()}
        </div>
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
  const summary = run.resultsByImpl[impl.id];
  const display = computeDisplay(run, summary);
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
        <Link to={href} tabIndex={-1}>
          {impl.name}
        </Link>
        {impl.version && <div className="pass-rate-meta">{impl.version}</div>}
      </td>
      <td className="pass-rate-cell">
        <div className="pass-rate-value">{display.passPct.toFixed(1)}%</div>
        <div className="pass-rate-meta">
          {display.passed} / {display.total} passed
        </div>
        <div className="full-width-bar">
          <PassRateBar passPct={display.passPct} />
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
