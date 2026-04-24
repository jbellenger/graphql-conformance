import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaticJsonRepository } from './StaticJsonRepository';
import type { Impl, Result, Run } from './types';

function makeFetch(map: Record<string, unknown | 404>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = Object.keys(map).find((k) => url.endsWith(k));
    if (!key) {
      return new Response(`no fixture for ${url}`, {
        status: 500,
        statusText: 'no fixture',
      });
    }
    const value = map[key];
    if (value === 404) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('StaticJsonRepository', () => {
  const baseUrl = 'http://example.test/data/';
  let fetchSpy: typeof fetch;

  beforeEach(() => {
    const impls: Impl[] = [
      {
        id: 'graphql-js-17',
        name: 'graphql-js-17',
        language: 'JavaScript',
        isReference: true,
      },
      {
        id: 'graphql-java',
        name: 'graphql-java',
        language: 'Java',
        isReference: false,
      },
    ];
    const run: Run = {
      id: 'r1',
      timestamp: '2026-04-24T00:00:00Z',
      referenceImplId: 'graphql-js-17',
      implIds: ['graphql-js-17', 'graphql-java'],
      testCaseCount: 100,
      resultsByImpl: {
        'graphql-js-17': {
          implId: 'graphql-js-17',
          failed: 0,
          excluded: 2,
          errored: 0,
          results: [],
        },
        'graphql-java': {
          implId: 'graphql-java',
          failed: 3,
          excluded: 0,
          errored: 0,
          results: [],
        },
      },
    };
    const javaShard: Result[] = [
      {
        id: 'result-java-1',
        runId: 'r1',
        implId: 'graphql-java',
        testCaseId: 'tc-alpha',
        status: 'fail',
        expected: { data: { x: 1 } },
        actual: { data: { x: 2 } },
      },
    ];
    fetchSpy = makeFetch({
      'impls.json': impls,
      'runs.json': [run],
      'runs/r1/summary.json': run,
      'runs/r1/results/graphql-java.json': javaShard,
    });
  });

  it('listImpls fetches impls.json', async () => {
    const repo = new StaticJsonRepository(baseUrl, fetchSpy);
    const impls = await repo.listImpls();
    expect(impls.map((i) => i.id)).toEqual(['graphql-js-17', 'graphql-java']);
  });

  it('getLatestRun pulls the first entry of runs.json', async () => {
    const repo = new StaticJsonRepository(baseUrl, fetchSpy);
    const run = await repo.getLatestRun();
    expect(run?.id).toBe('r1');
    expect(run?.referenceImplId).toBe('graphql-js-17');
  });

  it('findResult loads the per-impl shard and matches by testCaseId', async () => {
    const repo = new StaticJsonRepository(baseUrl, fetchSpy);
    const result = await repo.findResult('r1', 'graphql-java', 'tc-alpha');
    expect(result).toMatchObject({ id: 'result-java-1', status: 'fail' });

    const miss = await repo.findResult('r1', 'graphql-java', 'missing');
    expect(miss).toBeNull();
  });

  it('listResults requires runId and implId in Phase 1', async () => {
    const repo = new StaticJsonRepository(baseUrl, fetchSpy);
    await expect(repo.listResults({})).rejects.toThrow(/runId and implId/);
  });

  it('getRun returns null for a missing run (404)', async () => {
    const spy = makeFetch({
      'runs/unknown/summary.json': 404,
    });
    const repo = new StaticJsonRepository(baseUrl, spy);
    expect(await repo.getRun('unknown')).toBeNull();
  });

  it('caches identical requests within a single repository instance', async () => {
    const repo = new StaticJsonRepository(baseUrl, fetchSpy);
    await repo.listImpls();
    await repo.listImpls();
    await repo.getImpl('graphql-java'); // also calls impls.json internally
    const calls = (fetchSpy as unknown as { mock: { calls: unknown[] } }).mock
      .calls;
    expect(calls).toHaveLength(1);
  });
});
