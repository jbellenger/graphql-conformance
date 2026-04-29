import { describe, expect, it } from 'vitest';
import { FakeRepository, implRunResults } from '../repository/FakeRepository';
import type { Result, Run } from '../repository/types';
import {
  loadRunTestCaseOutcomes,
  loadTestCaseHistory,
  loadTestCaseOutcome,
} from './testCaseOutcomes';

const REF = 'graphql-js-17';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-a',
    timestamp: '2026-04-24T12:00:00Z',
    referenceImplId: REF,
    implIds: [REF, 'graphql-java', 'graphql-go'],
    excluded: 0,
    resultsByImpl: {
      [REF]: implRunResults(REF, { total: 100, passed: 99 }),
      'graphql-java': implRunResults('graphql-java', {
        total: 100,
        passed: 99,
        failed: 1,
      }),
      'graphql-go': implRunResults('graphql-go', { total: 100, passed: 100 }),
    },
    ...overrides,
  };
}

function mkResult(partial: Partial<Result>): Result {
  return {
    id: partial.id ?? 'r',
    runId: partial.runId ?? 'run-a',
    implId: partial.implId ?? 'graphql-java',
    testCaseId: partial.testCaseId ?? 'tc',
    status: partial.status ?? 'fail',
    ...partial,
  };
}

describe('testCaseOutcomes', () => {
  it('loadTestCaseOutcome marks pass when no stored result for a non-reference impl', async () => {
    const repo = new FakeRepository({
      impls: [{ id: REF, name: REF, language: 'js' }],
      runs: [makeRun()],
      results: [],
    });
    const outcome = await loadTestCaseOutcome(
      repo,
      makeRun(),
      'graphql-go',
      'tc',
    );
    expect(outcome.status).toBe('pass');
    expect(outcome.result).toBeNull();
  });

  it('loadTestCaseOutcome reports fail status with the stored result', async () => {
    const result = mkResult({ status: 'fail' });
    const repo = new FakeRepository({ results: [result] });
    const outcome = await loadTestCaseOutcome(
      repo,
      makeRun(),
      'graphql-java',
      'tc',
    );
    expect(outcome.status).toBe('fail');
    expect(outcome.result?.id).toBe(result.id);
  });

  it('loadTestCaseOutcome reports error status', async () => {
    const repo = new FakeRepository({
      results: [mkResult({ status: 'error', error: 'crash' })],
    });
    const outcome = await loadTestCaseOutcome(
      repo,
      makeRun(),
      'graphql-java',
      'tc',
    );
    expect(outcome.status).toBe('error');
  });

  it('loadTestCaseOutcome propagates reference exclusion to non-reference impls', async () => {
    // The reference excluded this test case; no graphql-java result was
    // recorded because the reference dropped the case upstream. The peer
    // outcome should reflect "excluded" rather than "pass".
    const refExcl = mkResult({
      implId: REF,
      status: 'excluded',
      id: 'ref-excl',
    });
    const repo = new FakeRepository({ results: [refExcl] });
    const outcome = await loadTestCaseOutcome(
      repo,
      makeRun({ excluded: 1 }),
      'graphql-java',
      'tc',
    );
    expect(outcome.status).toBe('excluded');
    expect(outcome.referenceResult?.id).toBe('ref-excl');
  });

  it('loadTestCaseOutcome marks absent rows from fallen-out impls as skipped', async () => {
    const run = makeRun({
      resultsByImpl: {
        [REF]: implRunResults(REF, { total: 100, passed: 100 }),
        'graphql-java': implRunResults('graphql-java', {
          total: 12,
          passed: 2,
          errored: 10,
          falloutAfter: 12,
        }),
        'graphql-go': implRunResults('graphql-go', {
          total: 100,
          passed: 100,
        }),
      },
    });
    const repo = new FakeRepository();
    const outcome = await loadTestCaseOutcome(
      repo,
      run,
      'graphql-java',
      'tc',
    );
    expect(outcome.status).toBe('skipped');
  });

  it('loadTestCaseOutcome uses the reference result directly when asked about the reference', async () => {
    const refExcl = mkResult({
      implId: REF,
      status: 'excluded',
      id: 'ref-excl',
    });
    const repo = new FakeRepository({ results: [refExcl] });
    const outcome = await loadTestCaseOutcome(repo, makeRun(), REF, 'tc');
    expect(outcome.status).toBe('excluded');
    expect(outcome.result?.id).toBe('ref-excl');
  });

  it('loadRunTestCaseOutcomes returns one outcome per impl in the run', async () => {
    const repo = new FakeRepository({
      results: [mkResult({ implId: 'graphql-java', status: 'fail' })],
    });
    const outcomes = await loadRunTestCaseOutcomes(repo, makeRun(), 'tc');
    const byImpl = Object.fromEntries(outcomes.map((o) => [o.implId, o.status]));
    expect(byImpl).toEqual({
      [REF]: 'pass',
      'graphql-java': 'fail',
      'graphql-go': 'pass',
    });
  });

  it('loadRunTestCaseOutcomes skips impls absent from resultsByImpl', async () => {
    // A run might list an impl in implIds but not include it in resultsByImpl
    // (e.g. bootstrap states). Those impls should not appear in the outcomes.
    const run = makeRun({
      implIds: [REF, 'graphql-java', 'ghost'],
    });
    const repo = new FakeRepository();
    const outcomes = await loadRunTestCaseOutcomes(repo, run, 'tc');
    expect(outcomes.map((o) => o.implId).sort()).toEqual(
      [REF, 'graphql-java'].sort(),
    );
  });

  it('loadTestCaseHistory emits one outcome per run the impl was part of', async () => {
    const runOld = makeRun({ id: 'run-old', timestamp: '2026-04-01T00:00:00Z' });
    const runNew = makeRun({ id: 'run-new', timestamp: '2026-04-24T00:00:00Z' });
    const repo = new FakeRepository({
      runs: [runOld, runNew],
      results: [
        mkResult({
          id: 'r-old',
          runId: 'run-old',
          implId: 'graphql-java',
          status: 'fail',
        }),
        // run-new has no stored fail → pass
      ],
    });
    const history = await loadTestCaseHistory(repo, 'graphql-java', 'tc');
    const byRun = Object.fromEntries(history.map((o) => [o.runId, o.status]));
    expect(byRun).toEqual({ 'run-old': 'fail', 'run-new': 'pass' });
  });

  it('loadTestCaseHistory skips runs where the impl did not participate', async () => {
    const runA = makeRun({ id: 'run-a', timestamp: '2026-04-24T00:00:00Z' });
    const runB = makeRun({
      id: 'run-b',
      timestamp: '2026-04-25T00:00:00Z',
      implIds: [REF],
      resultsByImpl: { [REF]: implRunResults(REF, { total: 1, passed: 1 }) },
    });
    const repo = new FakeRepository({ runs: [runA, runB] });
    const history = await loadTestCaseHistory(repo, 'graphql-java', 'tc');
    expect(history.map((o) => o.runId)).toEqual(['run-a']);
  });
});
