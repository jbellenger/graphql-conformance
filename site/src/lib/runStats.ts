import type { Impl, Run } from '../repository/types';
import { computePassPct } from './passRate';

// Derived per-impl statistics for a specific run. Shared by the dashboard
// cards and the impl detail page.
//
// `total` is per-impl (what this impl was subjected to); for the reference
// it's the full corpus, for a non-reference conformant it's corpus minus
// `run.excluded`, and for a fallen-out conformant it's how far the impl got
// before graduated testing removed it from the pool.
export interface RunStats {
  isReference: boolean;
  // Tests this impl was subjected to. Denominator for passPct.
  total: number;
  // Tests that passed conformance.
  passed: number;
  // 0-100, one decimal place. Floored so non-perfect runs never display as 100.0%.
  passPct: number;
  // Context-aware "failed" bucket:
  //   reference → tests where the reference couldn't produce output,
  //   non-reference → tests where the impl's output didn't match the
  //   reference's (or the driver errored).
  implFailed: number;
  // Context-aware "excluded" bucket:
  //   reference → 0 (the concept doesn't apply to the reference),
  //   non-reference → number of tests excluded by the reference, i.e. the
  //   reference's own failures that propagate as corpus exclusions.
  corpusExcluded: number;
  // Test count at which graduated testing dropped this impl. null when the
  // impl ran to completion (always null for the reference).
  falloutAfter: number | null;
}

export function computeRunStats(run: Run, impl: Impl): RunStats {
  const isReference = impl.id === run.referenceImplId;
  const implSummary = run.resultsByImpl[impl.id];

  const total = implSummary?.total ?? 0;
  const passed = implSummary?.passed ?? 0;
  // For the reference, "failed" in the user-facing sense is the number of
  // test cases the reference couldn't produce a clean output for. That's
  // captured as `run.excluded`. For a conformant, it's the impl's own
  // non-pass bucket (mismatches + driver errors).
  const implFailed = isReference
    ? (run.excluded ?? 0)
    : (implSummary?.failed ?? 0) + (implSummary?.errored ?? 0);
  const corpusExcluded = isReference ? 0 : (run.excluded ?? 0);
  const falloutAfter = implSummary?.falloutAfter ?? null;

  const passPct = computePassPct(passed, total);

  return {
    isReference,
    total,
    passed,
    passPct,
    implFailed,
    corpusExcluded,
    falloutAfter,
  };
}

// Returns the "N total · E excluded · F failed" subtext line. Reference
// impls don't get an "excluded" segment (the reference's tests aren't
// excluded from anything — they're the oracle). For fallen-out impls, the
// `total` is already the count up to fallout, which conveys the same
// information a "fell out after N" suffix would — no separate marker.
export function formatRunStatsLine(stats: RunStats): string {
  const parts = [`${stats.total} total`];
  if (!stats.isReference) parts.push(`${stats.corpusExcluded} excluded`);
  parts.push(`${stats.implFailed} failed`);
  return parts.join(' · ');
}
