import { useQuery } from '@tanstack/react-query';
import { useRepository } from './context';
import type { ResultFilter } from './Repository';
import type { Run } from './types';
import {
  loadRunTestCaseOutcomes,
  loadTestCaseHistory,
} from '../lib/testCaseOutcomes';
import { loadCorpusArtifacts } from '../lib/corpusArtifacts';

export function useImpls() {
  const repo = useRepository();
  return useQuery({
    queryKey: ['impls'],
    queryFn: () => repo.listImpls(),
  });
}

export function useImpl(id: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['impl', id],
    queryFn: () => repo.getImpl(id),
  });
}

export function useLatestRun() {
  const repo = useRepository();
  return useQuery({
    queryKey: ['run', 'latest'],
    queryFn: () => repo.getLatestRun(),
  });
}

export function useRun(id: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => (id ? repo.getRun(id) : null),
    enabled: id != null,
  });
}

// When runId is provided, load that specific run; otherwise fall back to the
// latest. Enables the "pinned run" URL scheme (/runs/:runId/...) alongside the
// existing latest-run routes.
export function useRunOrLatest(runId: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['run', runId ?? 'latest'],
    queryFn: () => (runId ? repo.getRun(runId) : repo.getLatestRun()),
  });
}

export function useResults(filter: ResultFilter) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['results', filter],
    queryFn: () => repo.listResults(filter),
    enabled: filter.runId != null && filter.implId != null,
  });
}

export function useResultLookup(
  runId: string | undefined,
  implId: string | undefined,
  testCaseId: string | undefined,
) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['result', runId, implId, testCaseId],
    queryFn: () =>
      runId && implId && testCaseId
        ? repo.findResult(runId, implId, testCaseId)
        : null,
    enabled: runId != null && implId != null && testCaseId != null,
  });
}

export function useImplHistory(implId: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['impl-history', implId],
    queryFn: () => (implId ? repo.getImplHistory(implId) : []),
    enabled: implId != null,
  });
}

export function useTestCaseHistory(
  implId: string | undefined,
  testCaseId: string | undefined,
) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['test-case-history', implId, testCaseId],
    queryFn: () =>
      implId && testCaseId ? loadTestCaseHistory(repo, implId, testCaseId) : [],
    enabled: implId != null && testCaseId != null,
  });
}

export function useRunTestCaseOutcomes(
  run: Run | null | undefined,
  testCaseId: string | undefined,
) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['run-test-case-outcomes', run?.id, testCaseId],
    queryFn: () =>
      run && testCaseId ? loadRunTestCaseOutcomes(repo, run, testCaseId) : [],
    enabled: run != null && testCaseId != null,
  });
}

// Corpus files are copied into the build next to the rest of `data/` so the
// failure-detail page works behind a firewall / offline (e.g. `make
// serve-site` inside Docker has no outbound network access to GitHub raw).
const CORPUS_DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`;

export function useCorpusArtifacts(testCaseId: string | undefined) {
  return useQuery({
    queryKey: ['corpus-artifacts', testCaseId],
    queryFn: () =>
      testCaseId
        ? loadCorpusArtifacts(testCaseId, CORPUS_DATA_BASE_URL)
        : null,
    enabled: testCaseId != null,
    // Corpus content is immutable per commit; keep it around for the session.
    staleTime: Infinity,
  });
}
