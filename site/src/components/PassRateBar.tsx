// Horizontal pass-rate bar shared by the dashboard impl rows, the reference
// card, and the failure-detail rate summaries. The tone thresholds mirror
// the rest of the dashboard: ≥95% green, ≥50% amber, otherwise red.
export function PassRateBar({ passPct }: { passPct: number }) {
  const tone =
    passPct >= 95 ? 'bar-pass' : passPct >= 50 ? 'bar-warn' : 'bar-fail';
  return (
    <div
      className="bar-container"
      aria-label={`${passPct.toFixed(1)}% passing`}
    >
      <div
        className={`bar-fill ${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, passPct))}%` }}
      />
    </div>
  );
}
