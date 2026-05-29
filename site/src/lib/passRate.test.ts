import { describe, expect, it } from 'vitest';
import { computePassPct } from './passRate';

describe('computePassPct', () => {
  it('floors to one decimal so a near-perfect run with failures is not shown as perfect', () => {
    expect(computePassPct(2815, 2816)).toBe(99.9);
    expect(computePassPct(9999, 10000)).toBe(99.9);
  });

  it('shows 100 only for perfect or empty-denominator runs', () => {
    expect(computePassPct(2816, 2816)).toBe(100);
    expect(computePassPct(0, 0)).toBe(100);
  });
});
