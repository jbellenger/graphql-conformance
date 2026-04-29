import type { Repository } from '../repository/Repository';
import type { Result, Run } from '../repository/types';

export type TestCaseOutcomeStatus =
  | 'pass'
  | 'fail'
  | 'error'
  | 'excluded'
  | 'skipped';

export interface TestCaseOutcome {
  runId: string;
  timestamp: string;
  implId: string;
  status: TestCaseOutcomeStatus;
  result: Result | null;
  referenceResult: Result | null;
}

export async function loadTestCaseOutcome(
  repo: Repository,
  run: Run,
  implId: string,
  testCaseId: string,
): Promise<TestCaseOutcome> {
  const [implResult, referenceResult] =
    implId === run.referenceImplId
      ? await loadReferenceOutcome(repo, run, testCaseId)
      : await Promise.all([
          repo.findResult(run.id, implId, testCaseId),
          repo.findResult(run.id, run.referenceImplId, testCaseId),
        ]);

  return {
    runId: run.id,
    timestamp: run.timestamp,
    implId,
    status: resolveOutcomeStatus(run, implId, implResult, referenceResult),
    result: implResult,
    referenceResult,
  };
}

export async function loadRunTestCaseOutcomes(
  repo: Repository,
  run: Run,
  testCaseId: string,
): Promise<TestCaseOutcome[]> {
  return Promise.all(
    run.implIds
      .filter((implId) => run.resultsByImpl[implId] != null)
      .map((implId) => loadTestCaseOutcome(repo, run, implId, testCaseId)),
  );
}

export async function loadTestCaseHistory(
  repo: Repository,
  implId: string,
  testCaseId: string,
): Promise<TestCaseOutcome[]> {
  const runs = await repo.listRuns();
  return Promise.all(
    runs
      .filter((run) => run.resultsByImpl[implId] != null)
      .map((run) => loadTestCaseOutcome(repo, run, implId, testCaseId)),
  );
}

function resolveOutcomeStatus(
  run: Run,
  implId: string,
  implResult: Result | null,
  referenceResult: Result | null,
): TestCaseOutcomeStatus {
  if (implResult?.status === 'fail') return 'fail';
  if (implResult?.status === 'error') return 'error';
  if (implResult?.status === 'excluded') return 'excluded';
  if (implId !== run.referenceImplId && referenceResult?.status === 'excluded') {
    return 'excluded';
  }
  if (implId !== run.referenceImplId) {
    const implSummary = run.resultsByImpl[implId];
    if (implSummary?.falloutAfter != null) return 'skipped';
  }
  return 'pass';
}

async function loadReferenceOutcome(
  repo: Repository,
  run: Run,
  testCaseId: string,
): Promise<[Result | null, Result | null]> {
  const result = await repo.findResult(run.id, run.referenceImplId, testCaseId);
  return [result, result];
}
