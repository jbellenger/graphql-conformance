import { describe, expect, it } from 'vitest';
import { computeRunStats, formatRunStatsLine } from './runStats';
import type { Impl, Run } from '../repository/types';

function makeRun(): Run {
  return {
    id: 'r1',
    timestamp: '2026-04-24T12:00:00Z',
    referenceImplId: 'graphql-js-17',
    implIds: ['graphql-js-17', 'graphql-java', 'hot-chocolate'],
    testCaseCount: 553,
    resultsByImpl: {
      'graphql-js-17': {
        implId: 'graphql-js-17',
        // 8 tests the reference couldn't produce expected output for.
        failed: 0,
        excluded: 8,
        errored: 0,
        results: [],
      },
      'graphql-java': {
        implId: 'graphql-java',
        failed: 0,
        excluded: 0,
        errored: 0,
        results: [],
      },
      'hot-chocolate': {
        implId: 'hot-chocolate',
        failed: 20,
        excluded: 0,
        errored: 4,
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

describe('computeRunStats', () => {
  it('reports reference failures (not exclusions) when viewing the reference', () => {
    const stats = computeRunStats(makeRun(), ref);
    expect(stats.isReference).toBe(true);
    expect(stats.total).toBe(553);
    expect(stats.implFailed).toBe(8); // ref's own failures
    expect(stats.corpusExcluded).toBe(0); // concept doesn't apply to ref
    expect(stats.passed).toBe(545);
    expect(stats.passPct).toBeCloseTo(98.6, 1);
  });

  it('treats the same count as "excluded" when viewing a non-reference impl', () => {
    const stats = computeRunStats(makeRun(), java);
    expect(stats.isReference).toBe(false);
    expect(stats.total).toBe(553);
    expect(stats.corpusExcluded).toBe(8); // from reference's own failures
    expect(stats.implFailed).toBe(0); // graphql-java had no failures/errors
    expect(stats.passed).toBe(553);
    expect(stats.passPct).toBe(100);
  });

  it('folds a non-reference impl\'s failed + errored into implFailed', () => {
    const stats = computeRunStats(makeRun(), hc);
    expect(stats.implFailed).toBe(24); // 20 failed + 4 errored
    expect(stats.corpusExcluded).toBe(8);
    expect(stats.passed).toBe(529); // 553 - 24
    expect(stats.passPct).toBeCloseTo(95.7, 1);
  });
});

describe('formatRunStatsLine', () => {
  it('for reference: "N total · F failed" (no excluded segment)', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), ref));
    expect(line).toBe('553 total · 8 failed');
  });

  it('for non-reference with zero-valued buckets, still shows all segments', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), java));
    expect(line).toBe('553 total · 8 excluded · 0 failed');
  });

  it('for non-reference with real failures, all three segments appear', () => {
    const line = formatRunStatsLine(computeRunStats(makeRun(), hc));
    expect(line).toBe('553 total · 8 excluded · 24 failed');
  });
});
