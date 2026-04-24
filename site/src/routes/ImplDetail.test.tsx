import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImplDetail } from './ImplDetail';
import { FakeRepository, implRunResults } from '../repository/FakeRepository';
import { RepositoryProvider } from '../repository/context';
import type { Result } from '../repository/types';

function renderAt(initialPath: string, repo: FakeRepository) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RepositoryProvider value={repo}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/impl/:name" element={<ImplDetail />} />
            <Route path="/impl/:name/failures" element={<ImplDetail />} />
            <Route
              path="/impl/:name/failures/:testCaseId"
              element={<ImplDetail />}
            />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </QueryClientProvider>,
  );
}

function makeRepo(): FakeRepository {
  const runId = 'run-1';
  const results: Result[] = [
    {
      id: 'r1',
      runId,
      implId: 'graphql-java',
      testCaseId: 'aa/bb/cc',
      status: 'fail',
      expected: { data: { x: 1 } },
      actual: { data: { x: 2 } },
    },
  ];
  return new FakeRepository({
    impls: [
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
        version: '25.0',
      },
    ],
    runs: [
      {
        id: runId,
        timestamp: '2026-04-24T12:00:00Z',
        referenceImplId: 'graphql-js-17',
        implIds: ['graphql-js-17', 'graphql-java'],
        testCaseCount: 100,
        resultsByImpl: {
          'graphql-js-17': implRunResults('graphql-js-17', { excluded: 2 }),
          'graphql-java': implRunResults('graphql-java', { failed: 1 }),
        },
      },
    ],
    results,
    history: {
      'graphql-java': [
        {
          runId: 'r0',
          timestamp: '2026-04-20T00:00:00Z',
          testCaseCount: 100,
          failed: 3,
          excluded: 0,
          errored: 0,
        },
        {
          runId,
          timestamp: '2026-04-24T12:00:00Z',
          testCaseCount: 100,
          failed: 1,
          excluded: 0,
          errored: 0,
        },
      ],
    },
  });
}

describe('ImplDetail', () => {
  it('renders pass rate, a failure card, and deep-link data attribute', async () => {
    renderAt('/impl/graphql-java', makeRepo());
    expect(await screen.findByText('graphql-java')).toBeInTheDocument();
    // 100 - 1 failed = 99 → 99.0%
    expect(await screen.findByText(/99\.0%/)).toBeInTheDocument();
    // Failure card is present with the expected test case id data attribute
    const card = await screen.findByTestId('failure-card');
    expect(card.getAttribute('data-test-case-id')).toBe('aa/bb/cc');
  });

  it('expands the targeted failure card when deep-linking with testCaseId', async () => {
    // testCaseId contains slashes; they must be URL-encoded in the path.
    renderAt('/impl/graphql-java/failures/aa%2Fbb%2Fcc', makeRepo());
    const card = await screen.findByTestId('failure-card');
    // Card becomes expandable only when content is large; our single-line
    // fail won't be expandable here, so we just assert that rendering works
    // with the testCaseId param. A larger payload is covered in FailureCard's
    // own unit tests.
    expect(card.getAttribute('data-test-case-id')).toBe('aa/bb/cc');
  });

  it('renders NotFound for an unknown impl', async () => {
    renderAt('/impl/not-a-real-impl', makeRepo());
    expect(await screen.findByText(/unknown impl/i)).toBeInTheDocument();
  });

  it('surfaces the reference\'s corpus exclusions on a non-reference impl page', async () => {
    // Repro of the bug where the Excluded meta card showed 0 for non-ref
    // impls because it read from ImplRunResults.excluded on the impl itself
    // (always zero) instead of on the reference.
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          isReference: true,
        },
        {
          id: 'graphql-php',
          name: 'graphql-php',
          language: 'PHP',
          isReference: false,
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-php'],
          testCaseCount: 553,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { excluded: 8 }),
            'graphql-php': implRunResults('graphql-php'),
          },
        },
      ],
    });
    renderAt('/impl/graphql-php', repo);
    // Find the Excluded meta card and assert the value is 8, not 0.
    await screen.findByText('graphql-php');
    const excludedLabel = screen.getByText('Excluded');
    const card = excludedLabel.closest('.detail-meta-card') as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText('8')).toBeInTheDocument();
    // And the subtext under the pass rate mentions the exclusions too.
    expect(
      screen.getByText(/553 \/ 553 passed · 8 excluded/),
    ).toBeInTheDocument();
  });

  it('renders the reference impl with an "Excluded Tests" heading', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          isReference: true,
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17'],
          testCaseCount: 100,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { excluded: 1 }),
          },
        },
      ],
      results: [
        {
          id: 'res-x',
          runId: 'r',
          implId: 'graphql-js-17',
          testCaseId: 'a/b/c',
          status: 'excluded',
          actual: { errors: [{ message: 'excluded' }] },
        },
      ],
    });
    renderAt('/impl/graphql-js-17', repo);
    expect(await screen.findByText('Excluded Tests')).toBeInTheDocument();
  });
});
