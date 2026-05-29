const PASS_RATE_DECIMAL_FACTOR = 10;

export function computePassPct(passed: number, total: number): number {
  if (total <= 0) return 100;

  const boundedPassed = Math.max(0, Math.min(passed, total));
  if (boundedPassed === total) return 100;

  return Math.floor((boundedPassed / total) * 100 * PASS_RATE_DECIMAL_FACTOR)
    / PASS_RATE_DECIMAL_FACTOR;
}
