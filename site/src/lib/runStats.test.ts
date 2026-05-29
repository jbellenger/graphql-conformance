import { describe, expect, it } from 'vitest';
import { computeRunStats, formatRunStatsLine } from './runStats';
import type { Impl, Run } from '../repository/types';

// Scenario:
//   - Reference sees all 553 tests; couldn't produce output on 8 → 545 passed.
//     `run.excluded` = 8.
//   - Non-reference impls see 553 - 8 = 545 tests (the excluded ones are
//     dropped from their corpus — nothing to compare to).
function makeRun(): Run {
  return {
    id: 'r1',
    timestamp: '2026-04-24T12:00:00Z',
    referenceImplId: 'graphql-js-17',
    implIds: ['graphql-js-17', 'graphql-java', 'hot-chocolate', 'fallout-impl'],
    excluded: 8,
    resultsByImpl: {
      'graphql-js-17': {
        implId: 'graphql-js-17',
        total: 553,
        passed: 545,
        failed: 0,
        errored: 0,
        falloutAfter: null,
        results: [],
      },
      'graphql-java': {
        implId: 'graphql-java',
        total: 545,
        passed: 545,
        failed: 0,
        errored: 0,
        falloutAfter: null,
        results: [],
      },
      'hot-chocolate': {
        implId: 'hot-chocolate',
        total: 545,
        passed: 521,
        failed: 20,
        errored: 4,
        falloutAfter: null,
        results: [],
      },
      'fallout-impl': {
        implId: 'fallout-impl',
        total: 50,
        passed: 39,
        failed: 10,
        errored: 1,
        falloutAfter: 50,
        results: [],
      },
    },
  };
}

const ref: Impl = {
  id: 'graphql-js-17',
  name: 'graphql-js-17',
  language: 'JavaScript',
};
const java: Impl = {
  id: 'graphql-java',
  name: 'graphql-java',
  language: 'Java',
};
const hc: Impl = {
  id: 'hot-chocolate',
  name: 'hot-chocolate',
  language: 'C#',
};
const fallout: Impl = {
  id: 'fallout-impl',
  name: 'fallout-impl',
  language: 'Hypothetical',
};

describe('computeRunStats', () => {
  it('reports reference failures (not exclusions) when viewing the reference', () => {
    const stats = computeRunStats(makeRun(), ref);
    expect(stats.isReference).toBe(true);
    expect(stats.total).toBe(553);
    expect(stats.passed).toBe(545);
    expect(stats.implFailed).toBe(8); // run.excluded surfaces as ref's "failed"
    expect(stats.corpusExcluded).toBe(0); // concept doesn't apply to ref
    expect(stats.passPct).toBe(98.5);
    expect(stats.falloutAfter).toBeNull();
  });

  it('treats run.excluded as "corpusExcluded" when viewing a non-reference impl', () => {
    const stats = computeRunStats(makeRun(), java);
    expect(stats.isReference).toBe(false);
    expect(stats.total).toBe(545); // corpus - excluded
    expect(stats.passed).toBe(545);
    expect(stats.corpusExcluded).toBe(8);
    expect(stats.implFailed).toBe(0);
    expect(stats.passPct).toBe(100);
    expect(stats.falloutAfter).toBeNull();
  });

  it('folds a non-reference impl\'s failed + errored into implFailed', () => {
    const stats = computeRunStats(makeRun(), hc);
    expect(stats.total).toBe(545);
    expect(stats.passed).toBe(521);
    expect(stats.implFailed).toBe(24); // 20 failed + 4 errored
    expect(stats.corpusExcluded).toBe(8);
    expect(stats.passPct).toBe(95.5);
  });

  it('surfaces falloutAfter and uses the impl\'s own total as denominator', () => {
    const stats = computeRunStats(makeRun(), fallout);
    expect(stats.total).toBe(50); // not 545 — the impl only saw 50 tests
    expect(stats.passed).toBe(39);
    expect(stats.implFailed).toBe(11);
    expect(stats.passPct).toBe(78); // 39/50
    expect(stats.falloutAfter).toBe(50);
  });
});

describe('formatRunStatsLine', () => {
  it('for reference: "N total · F failed" (no excluded segment)', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), ref));
    expect(line).toBe('553 total · 8 failed');
  });

  it('for non-reference with zero-valued buckets, still shows all segments', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), java));
    expect(line).toBe('545 total · 8 excluded · 0 failed');
  });

  it('for non-reference with real failures, all three segments appear', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), hc));
    expect(line).toBe('545 total · 8 excluded · 24 failed');
  });

  it('fallout: no extra suffix (the reduced total conveys fallout)', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), fallout));
    expect(line).toBe('50 total · 8 excluded · 11 failed');
  });
});
