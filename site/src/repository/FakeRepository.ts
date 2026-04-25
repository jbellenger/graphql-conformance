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

export interface FakeRepositoryData {
  impls?: Impl[];
  runs?: Run[];
  results?: Result[];
  testCases?: TestCase[];
  handCraftedTestCaseIds?: string[];
  testSchemas?: TestSchema[];
  testQueries?: TestQuery[];
  testVariables?: TestVariables[];
  history?: Record<string, ImplHistoryPoint[]>;
}

// Deterministic in-memory Repository for tests + previews.
export class FakeRepository implements Repository {
  private readonly impls: Impl[];
  private readonly runs: Run[];
  private readonly results: Result[];
  private readonly testCases: TestCase[];
  private readonly handCraftedTestCaseIds: Set<string>;
  private readonly testSchemas: TestSchema[];
  private readonly testQueries: TestQuery[];
  private readonly testVariables: TestVariables[];
  private readonly history: Record<string, ImplHistoryPoint[]>;

  constructor(data: FakeRepositoryData = {}) {
    this.impls = data.impls ?? [];
    this.runs = data.runs ?? [];
    this.results = data.results ?? [];
    this.testCases = data.testCases ?? [];
    this.handCraftedTestCaseIds = new Set(data.handCraftedTestCaseIds ?? []);
    this.testSchemas = data.testSchemas ?? [];
    this.testQueries = data.testQueries ?? [];
    this.testVariables = data.testVariables ?? [];
    this.history = data.history ?? {};
  }

  async getImplHistory(implId: string): Promise<ImplHistoryPoint[]> {
    return [...(this.history[implId] ?? [])];
  }

  async listImpls(): Promise<Impl[]> {
    return [...this.impls];
  }

  async getImpl(id: string): Promise<Impl | null> {
    return this.impls.find((i) => i.id === id) ?? null;
  }

  async listRuns(opts?: { limit?: number }): Promise<Run[]> {
    const sorted = [...this.runs].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp),
    );
    if (opts?.limit != null) return sorted.slice(0, opts.limit);
    return sorted;
  }

  async getLatestRun(): Promise<Run | null> {
    const runs = await this.listRuns({ limit: 1 });
    return runs[0] ?? null;
  }

  async getRun(id: string): Promise<Run | null> {
    return this.runs.find((r) => r.id === id) ?? null;
  }

  async getResult(id: string): Promise<Result | null> {
    return this.results.find((r) => r.id === id) ?? null;
  }

  async findResult(
    runId: string,
    implId: string,
    testCaseId: string,
  ): Promise<Result | null> {
    return (
      this.results.find(
        (r) =>
          r.runId === runId && r.implId === implId && r.testCaseId === testCaseId,
      ) ?? null
    );
  }

  async listResults(filter: ResultFilter): Promise<Result[]> {
    let out = this.results.filter((r) => {
      if (filter.runId != null && r.runId !== filter.runId) return false;
      if (filter.implId != null && r.implId !== filter.implId) return false;
      if (filter.testCaseId != null && r.testCaseId !== filter.testCaseId)
        return false;
      if (filter.status != null) {
        const wanted = Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
        if (!wanted.includes(r.status)) return false;
      }
      return true;
    });
    if (filter.offset != null) out = out.slice(filter.offset);
    if (filter.limit != null) out = out.slice(0, filter.limit);
    return out;
  }

  async getTestCase(id: string): Promise<TestCase | null> {
    return this.testCases.find((c) => c.id === id) ?? null;
  }

  async listTestCases(filter?: TestCaseFilter): Promise<TestCase[]> {
    let out = [...this.testCases];
    if (filter?.schemaId != null)
      out = out.filter((c) => c.schemaId === filter.schemaId);
    if (filter?.queryId != null)
      out = out.filter((c) => c.queryId === filter.queryId);
    if (filter?.offset != null) out = out.slice(filter.offset);
    if (filter?.limit != null) out = out.slice(0, filter.limit);
    return out;
  }

  async listHandCraftedTestCases(): Promise<TestCase[]> {
    return this.testCases.filter((c) => this.handCraftedTestCaseIds.has(c.id));
  }

  async getTestSchema(id: string): Promise<TestSchema | null> {
    return this.testSchemas.find((s) => s.id === id) ?? null;
  }

  async getTestQuery(id: string): Promise<TestQuery | null> {
    return this.testQueries.find((q) => q.id === id) ?? null;
  }

  async getTestVariables(id: string): Promise<TestVariables | null> {
    return this.testVariables.find((v) => v.id === id) ?? null;
  }
}

// Helper: build a realistic ImplRunResults from result counts. Useful when
// constructing a fixture Run quickly. `total` defaults to passed+failed+errored
// when not specified; `passed` defaults to total-failed-errored.
export function implRunResults(
  implId: string,
  counts: {
    total?: number;
    passed?: number;
    failed?: number;
    errored?: number;
    falloutAfter?: number | null;
  } = {},
  results: Result[] = [],
): ImplRunResults {
  const failed = counts.failed ?? 0;
  const errored = counts.errored ?? 0;
  const total = counts.total ?? (counts.passed ?? 0) + failed + errored;
  const passed = counts.passed ?? Math.max(0, total - failed - errored);
  return {
    implId,
    total,
    passed,
    failed,
    errored,
    falloutAfter: counts.falloutAfter ?? null,
    results,
  };
}
