import type {
  Impl,
  ImplHistoryPoint,
  ImplRunResults,
  Result,
  Run,
  TestCase,
  TestQuery,
  TestSchema,
  TestVariables,
} from './types';
import type { Repository, ResultFilter, TestCaseFilter } from './Repository';

// Phase 1 Repository: reads bundled JSON from `baseUrl` + logical subpaths.
//
// On-disk layout (produced by tools/build-data.mjs):
//   impls.json                           — Impl[]
//   runs.json                            — Run[] (newest first, lightweight)
//   runs/<runId>/summary.json            — Run with counts-only ImplRunResults
//   runs/<runId>/results/<implId>.json   — Result[] for (run, impl) shard
//   test-cases/<id>.json                 — TestCase
//   test-cases-hand-crafted.json         — TestCase[]
//   test-schemas/<id>.json               — TestSchema
//   test-queries/<id>.json               — TestQuery
//   test-variables/<id>.json             — TestVariables
export class StaticJsonRepository implements Repository {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  // Tiny local memo; repository is re-created per page load, so a Map is
  // sufficient. TanStack Query owns the app-level cache.
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    // Normalise to a trailing '/' so join is simple.
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.fetchImpl = fetchImpl;
  }

  private async getJson<T>(relativePath: string): Promise<T | null> {
    const url = this.baseUrl + relativePath;
    const existing = this.cache.get(url);
    if (existing) return (await existing) as T | null;
    const promise = (async () => {
      const res = await this.fetchImpl(url);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(
          `fetch ${url} failed with status ${res.status} ${res.statusText}`,
        );
      }
      return (await res.json()) as unknown;
    })();
    this.cache.set(url, promise);
    return (await promise) as T | null;
  }

  async listImpls(): Promise<Impl[]> {
    const data = await this.getJson<Impl[]>('impls.json');
    return data ?? [];
  }

  async getImpl(id: string): Promise<Impl | null> {
    const impls = await this.listImpls();
    return impls.find((i) => i.id === id) ?? null;
  }

  async listRuns(opts?: { limit?: number }): Promise<Run[]> {
    const data = (await this.getJson<Run[]>('runs.json')) ?? [];
    if (opts?.limit != null) return data.slice(0, opts.limit);
    return data;
  }

  async getLatestRun(): Promise<Run | null> {
    const runs = await this.listRuns({ limit: 1 });
    return runs[0] ?? null;
  }

  async getRun(id: string): Promise<Run | null> {
    return this.getJson<Run>(`runs/${encodeURIComponent(id)}/summary.json`);
  }

  async getResult(_id: string): Promise<Result | null> {
    // Results are only stored within per-impl shards in Phase 1; a direct
    // by-UUID lookup would require a separate index. Use findResult() for
    // compound access. If this path is needed later, add `results-index.json`.
    return null;
  }

  async findResult(
    runId: string,
    implId: string,
    testCaseId: string,
  ): Promise<Result | null> {
    const shard = await this.loadResultShard(runId, implId);
    return shard.find((r) => r.testCaseId === testCaseId) ?? null;
  }

  async listResults(filter: ResultFilter): Promise<Result[]> {
    if (filter.runId == null || filter.implId == null) {
      throw new Error(
        'StaticJsonRepository.listResults requires both runId and implId — per-impl shards only.',
      );
    }
    let out = await this.loadResultShard(filter.runId, filter.implId);
    if (filter.testCaseId != null) {
      out = out.filter((r) => r.testCaseId === filter.testCaseId);
    }
    if (filter.status != null) {
      const wanted = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      out = out.filter((r) => wanted.includes(r.status));
    }
    if (filter.offset != null) out = out.slice(filter.offset);
    if (filter.limit != null) out = out.slice(0, filter.limit);
    return out;
  }

  private async loadResultShard(
    runId: string,
    implId: string,
  ): Promise<Result[]> {
    const path = `runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(
      implId,
    )}.json`;
    const shard = (await this.getJson<Result[]>(path)) ?? [];
    return shard;
  }

  async getImplHistory(implId: string): Promise<ImplHistoryPoint[]> {
    const data = await this.getJson<ImplHistoryPoint[]>(
      `impls/${encodeURIComponent(implId)}/history.json`,
    );
    return data ?? [];
  }

  async getTestCase(id: string): Promise<TestCase | null> {
    return this.getJson<TestCase>(`test-cases/${encodeURIComponent(id)}.json`);
  }

  async listTestCases(_filter?: TestCaseFilter): Promise<TestCase[]> {
    // Listing all test cases in Phase 1 would require a separate index file.
    // Callers typically need TestCase by id (via getTestCase). If broad listing
    // is wanted, emit `test-cases.json` and read it here.
    return [];
  }

  async listHandCraftedTestCases(): Promise<TestCase[]> {
    const data = await this.getJson<TestCase[]>('test-cases-hand-crafted.json');
    return data ?? [];
  }

  async getTestSchema(id: string): Promise<TestSchema | null> {
    return this.getJson<TestSchema>(
      `test-schemas/${encodeURIComponent(id)}.json`,
    );
  }

  async getTestQuery(id: string): Promise<TestQuery | null> {
    return this.getJson<TestQuery>(
      `test-queries/${encodeURIComponent(id)}.json`,
    );
  }

  async getTestVariables(id: string): Promise<TestVariables | null> {
    return this.getJson<TestVariables>(
      `test-variables/${encodeURIComponent(id)}.json`,
    );
  }
}

// Hydrate Run.resultsByImpl for a given impl by fetching its shard and merging.
// Returns a new ImplRunResults with the results array populated; leaves the
// original Run unchanged.
export async function hydrateImplRunResults(
  repo: StaticJsonRepository,
  run: Run,
  implId: string,
): Promise<ImplRunResults> {
  const base = run.resultsByImpl[implId];
  if (!base) throw new Error(`Run ${run.id} has no summary for impl ${implId}`);
  const results = await repo.listResults({ runId: run.id, implId });
  return { ...base, results };
}
