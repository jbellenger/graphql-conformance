import type {
  Impl,
  ImplHistoryPoint,
  Result,
  ResultStatus,
  Run,
  TestCase,
  TestQuery,
  TestSchema,
  TestVariables,
} from './types';

// Data access abstraction (plan P6.2). Swappable backends without UI changes.
export interface Repository {
  // Impls — "which impls are supported?"
  listImpls(): Promise<Impl[]>;
  getImpl(id: string): Promise<Impl | null>;

  // Runs
  listRuns(opts?: { limit?: number }): Promise<Run[]>;
  getLatestRun(): Promise<Run | null>;
  getRun(id: string): Promise<Run | null>;

  // Results — by Result.id (UUID).
  getResult(id: string): Promise<Result | null>;
  // Compound lookup. Returns null when the outcome was a pass (not stored)
  // or when the test case wasn't in the run.
  findResult(
    runId: string,
    implId: string,
    testCaseId: string,
  ): Promise<Result | null>;
  listResults(filter: ResultFilter): Promise<Result[]>;

  // Per-impl history (pre-aggregated across prior runs).
  getImplHistory(implId: string): Promise<ImplHistoryPoint[]>;

  // Test cases + composed parts.
  getTestCase(id: string): Promise<TestCase | null>;
  listTestCases(filter?: TestCaseFilter): Promise<TestCase[]>;
  listHandCraftedTestCases(): Promise<TestCase[]>;
  getTestSchema(id: string): Promise<TestSchema | null>;
  getTestQuery(id: string): Promise<TestQuery | null>;
  getTestVariables(id: string): Promise<TestVariables | null>;
}

export interface ResultFilter {
  runId?: string;
  implId?: string;
  testCaseId?: string;
  status?: ResultStatus | ResultStatus[];
  limit?: number;
  offset?: number;
}

export interface TestCaseFilter {
  schemaId?: string;
  queryId?: string;
  limit?: number;
  offset?: number;
}
