import type { Impl, Run } from '../repository/types';

// Derived per-impl statistics for a specific run. Shared by the dashboard
// cards and the impl detail page; keeps the "reference vs non-reference"
// semantics in one place rather than duplicated at each call site.
//
// Reference vs non-reference:
// - When the reference impl can't produce a clean expected output for a test
//   case, the test is "failed" from the reference's perspective. Those same
//   tests become "excluded" from every non-reference impl's corpus (they
//   aren't run against non-ref impls because there's nothing to compare to).
// - So the same underlying number (`refSummary.excluded` in the data model)
//   surfaces with different labels depending on which impl's page is shown.
export interface RunStats {
  isReference: boolean;
  // Corpus size — the denominator for passPct, identical across impls.
  total: number;
  // Tests that produced the expected output (= total - implFailed).
  passed: number;
  // 0-100, one decimal place.
  passPct: number;
  // Context-aware "failed" bucket:
  //   reference → tests where the reference couldn't produce output,
  //   non-reference → tests where the impl's output didn't match the
  //   reference's (or the driver errored).
  implFailed: number;
  // Context-aware "excluded" bucket:
  //   reference → 0 (the concept doesn't apply to the reference),
  //   non-reference → number of tests excluded by the reference, i.e.
  //   the reference's own failures that propagate as corpus exclusions.
  corpusExcluded: number;
}

export function computeRunStats(run: Run, impl: Impl): RunStats {
  const isReference = impl.id === run.referenceImplId;
  const refSummary = run.resultsByImpl[run.referenceImplId];
  const implSummary = run.resultsByImpl[impl.id];
  const total = run.testCaseCount;
  const refUncomputable = refSummary?.excluded ?? 0;

  const implFailed = isReference
    ? refUncomputable
    : (implSummary?.failed ?? 0) + (implSummary?.errored ?? 0);
  const corpusExcluded = isReference ? 0 : refUncomputable;

  const passed = Math.max(0, total - implFailed);
  const passPct = total > 0 ? Math.round((passed / total) * 1000) / 10 : 100;

  return {
    isReference,
    total,
    passed,
    passPct,
    implFailed,
    corpusExcluded,
  };
}

// Returns the "N total · E excluded · F failed" subtext line. Reference
// impls don't get an "excluded" segment (the reference's tests aren't
// excluded from anything — they're the oracle).
export function formatRunStatsLine(stats: RunStats): string {
  const parts = [`${stats.total} total`];
  if (!stats.isReference) parts.push(`${stats.corpusExcluded} excluded`);
  parts.push(`${stats.implFailed} failed`);
  return parts.join(' · ');
}
