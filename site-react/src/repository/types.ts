// Types mirror plan P6.1.

export interface Impl {
  id: string;
  name: string;
  language: string;
  isReference: boolean;
  manifestUrl?: string;
  repoUrl?: string;
  version?: string;
  versionUrl?: string;
}

export interface Run {
  id: string;
  timestamp: string;
  referenceImplId: string;
  commitSha?: string;
  implIds: string[];
  testCaseCount: number;
  resultsByImpl: Record<string, ImplRunResults>;
}

// Per-impl breakdown of a Run: aggregate counts plus non-pass Result objects.
// `passed` count is derivable: Run.testCaseCount - (failed + excluded + errored).
// In StaticJsonRepository, `results` is populated lazily from the per-impl shard
// (see P7.1 / F14). Dashboard-path Run fetches leave `results: []`; impl-detail
// fetches hydrate the array.
export interface ImplRunResults {
  implId: string;
  failed: number;
  excluded: number;
  errored: number;
  results: Result[];
}

export type ResultStatus = 'fail' | 'excluded' | 'error';

// Result carries a UUID primary key plus FK fields so it can be queried/joined
// independently of storage layout.
export interface Result {
  id: string;
  runId: string;
  implId: string;
  testCaseId: string;
  status: ResultStatus;
  expected?: unknown;
  actual?: unknown;
  error?: string;
  stderr?: string;
  durationMs?: number;
}

export interface TestCase {
  id: string;
  schemaId: string;
  queryId: string;
  variablesId?: string;
}

export interface TestSchema {
  id: string;
  sdl: string;
}

export interface TestQuery {
  id: string;
  document: string;
}

export interface TestVariables {
  id: string;
  values: Record<string, unknown>;
}
