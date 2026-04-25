import { describe, expect, it } from 'vitest';
import { FakeRepository, implRunResults } from './FakeRepository';
import type { Impl, Result, Run, TestCase } from './types';

function sampleImpl(overrides: Partial<Impl> = {}): Impl {
  return {
    id: 'graphql-java',
    name: 'graphql-java',
    language: 'Java',
    ...overrides,
  };
}

function sampleRun(overrides: Partial<Run> = {}): Run {
  const referenceImplId = overrides.referenceImplId ?? 'graphql-js-17';
  return {
    id: '00000000-0000-0000-0000-000000000001',
    timestamp: '2026-04-24T12:00:00Z',
    referenceImplId,
    implIds: [referenceImplId, 'graphql-java'],
    excluded: 2,
    resultsByImpl: {
      [referenceImplId]: implRunResults(referenceImplId, { total: 100, passed: 98 }),
      'graphql-java': implRunResults('graphql-java', { total: 98, passed: 95, failed: 3 }),
    },
    ...overrides,
  };
}

function sampleResult(overrides: Partial<Result> = {}): Result {
  return {
    id: 'res-1',
    runId: '00000000-0000-0000-0000-000000000001',
    implId: 'graphql-java',
    testCaseId: 'tc-a',
    status: 'fail',
    expected: { data: { x: 1 } },
    actual: { data: { x: 2 } },
    ...overrides,
  };
}

describe('FakeRepository', () => {
  it('listImpls returns all impls, getImpl finds by id', async () => {
    const repo = new FakeRepository({
      impls: [sampleImpl(), sampleImpl({ id: 'graphql-go', name: 'graphql-go', language: 'Go' })],
    });
    expect(await repo.listImpls()).toHaveLength(2);
    expect(await repo.getImpl('graphql-go')).toMatchObject({ language: 'Go' });
    expect(await repo.getImpl('missing')).toBeNull();
  });

  it('getLatestRun returns the newest run by timestamp', async () => {
    const older = sampleRun({
      id: 'older',
      timestamp: '2026-04-01T00:00:00Z',
    });
    const newer = sampleRun({
      id: 'newer',
      timestamp: '2026-04-24T00:00:00Z',
    });
    const repo = new FakeRepository({ runs: [older, newer] });
    const latest = await repo.getLatestRun();
    expect(latest?.id).toBe('newer');
  });

  it('findResult does a compound lookup; returns null when no match', async () => {
    const hit = sampleResult({ id: 'hit' });
    const miss = sampleResult({
      id: 'miss',
      testCaseId: 'tc-b',
    });
    const repo = new FakeRepository({ results: [hit, miss] });
    const found = await repo.findResult(
      '00000000-0000-0000-0000-000000000001',
      'graphql-java',
      'tc-a',
    );
    expect(found?.id).toBe('hit');
    const notFound = await repo.findResult('other-run', 'graphql-java', 'tc-a');
    expect(notFound).toBeNull();
  });

  it('listResults filters by runId, implId, status', async () => {
    const r1 = sampleResult({ id: '1', status: 'fail' });
    const r2 = sampleResult({ id: '2', status: 'excluded' });
    const r3 = sampleResult({ id: '3', implId: 'graphql-go', status: 'fail' });
    const repo = new FakeRepository({ results: [r1, r2, r3] });

    const javaFails = await repo.listResults({
      runId: '00000000-0000-0000-0000-000000000001',
      implId: 'graphql-java',
      status: 'fail',
    });
    expect(javaFails.map((r) => r.id)).toEqual(['1']);

    const javaAll = await repo.listResults({
      runId: '00000000-0000-0000-0000-000000000001',
      implId: 'graphql-java',
    });
    expect(javaAll).toHaveLength(2);

    const allFails = await repo.listResults({
      runId: '00000000-0000-0000-0000-000000000001',
      status: ['fail'],
    });
    expect(allFails.map((r) => r.id).sort()).toEqual(['1', '3']);
  });

  it('listHandCraftedTestCases returns only flagged ids', async () => {
    const hand: TestCase = {
      id: '0',
      schemaId: 's0',
      queryId: 'q0',
    };
    const gen: TestCase = {
      id: 'gen-1',
      schemaId: 's1',
      queryId: 'q1',
    };
    const repo = new FakeRepository({
      testCases: [hand, gen],
      handCraftedTestCaseIds: ['0'],
    });
    const handOnly = await repo.listHandCraftedTestCases();
    expect(handOnly.map((c) => c.id)).toEqual(['0']);
  });
});
