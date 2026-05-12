// Types mirror the Repository-shaped JSON emitted by the conformer (see
// conformer/src/index.js → writeRun) and consumed by Repository implementations
// (FakeRepository, StaticJsonRepository). Reference-ness is per-run: derive
// with `impl.id === run.referenceImplId`.

export interface Impl {
  id: string;
  name: string;
  language: string;
  manifestUrl?: string;
  repoUrl?: string;
  version?: string;
  versionUrl?: string;
  versionUrlTemplate?: string;
}

export interface RunImplMeta {
  imageDigest?: string | null;
  version?: string | null;
  versionUrl?: string | null;
}

export interface ConformerMeta {
  corpusFingerprint?: string;
  runnableCount?: number;
  implMeta?: Record<string, RunImplMeta>;
}

export interface Run {
  id: string;
  timestamp: string;
  referenceImplId: string;
  commitSha?: string;
  implIds: string[];
  // Count of test cases the reference couldn't produce a clean output for.
  // These are dropped from every conformant's corpus (nothing to compare to)
  // and surface as Result rows with status='excluded' on the reference's
  // shard. Corpus size = resultsByImpl[referenceImplId].total.
  excluded: number;
  resultsByImpl: Record<string, ImplRunResults>;
  _conformerMeta?: ConformerMeta;
}

// Per-impl breakdown of a Run. `total` is what this impl was subjected to;
// for the reference it's the full corpus, for non-reference it's
// corpus - run.excluded, and for a fallen-out conformant it's how far the
// impl got before fallout. Invariant: total ≤ resultsByImpl[referenceImplId].total.
//
// `passed` is stored explicitly (not derived) to match the future D1
// aggregate-row shape and to survive round-trips through histories.
//
// In StaticJsonRepository, `results` is populated lazily from the per-impl
// shard. Dashboard-path fetches leave `results: []`; impl-detail fetches
// hydrate the array.
export interface ImplRunResults {
  implId: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  // Test count at which graduated testing dropped this impl from the pool.
  // null when the impl ran to completion.
  falloutAfter: number | null;
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

// Per-impl history point for the detail page chart. Derived from prior Runs;
// stored as a pre-aggregated shard to keep the dashboard path cheap. Carries
// per-impl counts rather than the corpus denominator so that a fallen-out
// impl's point accurately reflects what was measured (e.g. 12/50), not a
// misleading 12/553.
export interface ImplHistoryPoint {
  runId: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  falloutAfter: number | null;
}
