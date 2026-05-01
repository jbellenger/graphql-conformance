import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
            <Route path="/runs/:runId/impl/:name" element={<ImplDetail />} />
            <Route
              path="/runs/:runId/impl/:name/failures"
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
      },
      {
        id: 'graphql-java',
        name: 'graphql-java',
        language: 'Java',
        version: '25.0',
      },
    ],
    runs: [
      {
        id: runId,
        timestamp: '2026-04-24T12:00:00Z',
        referenceImplId: 'graphql-js-17',
        implIds: ['graphql-js-17', 'graphql-java'],
        excluded: 2,
        resultsByImpl: {
          'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 98 }),
          'graphql-java': implRunResults('graphql-java', { total: 98, passed: 97, failed: 1 }),
        },
      },
    ],
    results,
    history: {
      'graphql-java': [
        {
          runId: 'r0',
          timestamp: '2026-04-20T00:00:00Z',
          total: 98,
          passed: 95,
          failed: 3,
          errored: 0,
          falloutAfter: null,
        },
        {
          runId,
          timestamp: '2026-04-24T12:00:00Z',
          total: 98,
          passed: 97,
          failed: 1,
          errored: 0,
          falloutAfter: null,
        },
      ],
    },
  });
}

describe('ImplDetail', () => {
  it('renders pass rate, a failure card, and deep-link data attribute', async () => {
    const { container } = renderAt('/impl/graphql-java', makeRepo());
    expect(await screen.findByText('graphql-java')).toBeInTheDocument();
    // 100 - 1 failed = 99 → 99.0% — match the headline rate, not the sibling
    // occurrences in the Recent runs table / chart.
    const detailRate = container.querySelector('.detail-rate');
    expect(detailRate?.textContent).toMatch(/99\.0%/);
    // Failure card is present with the expected test case id data attribute
    const card = await screen.findByTestId('failure-card');
    expect(card.getAttribute('data-test-case-id')).toBe('aa/bb/cc');
  });

  it('links each failure card to the single-failure detail page', async () => {
    renderAt('/runs/run-1/impl/graphql-java/failures', makeRepo());
    const link = await screen.findByRole('link', {
      name: /view failure detail for aa\/bb\/cc/i,
    });
    expect(link).toHaveAttribute(
      'href',
      '/runs/run-1/impl/graphql-java/failures/aa%2Fbb%2Fcc',
    );
  });

  it('renders NotFound for an unknown impl', async () => {
    renderAt('/impl/not-a-real-impl', makeRepo());
    expect(await screen.findByText(/unknown impl/i)).toBeInTheDocument();
  });

  it('renders the pinned run when the URL includes /runs/:runId/impl/:name', async () => {
    const oldRunId = 'older-run';
    const newRunId = 'run-1';
    const repo = new FakeRepository({
      impls: [
        { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
        { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
      ],
      runs: [
        {
          id: newRunId,
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 99, failed: 1 }),
          },
        },
        {
          id: oldRunId,
          timestamp: '2026-04-20T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 40, failed: 60 }),
          },
        },
      ],
    });
    const { container } = renderAt(
      `/runs/${oldRunId}/impl/graphql-java`,
      repo,
    );
    // Pinned run: 40/100 = 40.0% (not the latest run's 99.0%). Match the
    // headline rate specifically — the Recent runs table also renders these.
    await screen.findByText('graphql-java');
    const detailRate = container.querySelector('.detail-rate');
    expect(detailRate?.textContent).toMatch(/40\.0%/);
    expect(detailRate?.textContent).not.toMatch(/99\.0%/);
  });

  it('renders NotFound with an impl-latest fallback when runId is unknown', async () => {
    renderAt('/runs/bogus-run/impl/graphql-java', makeRepo());
    const card = await screen.findByTestId('not-found');
    expect(
      within(card).getByText(/that run isn't in the index/i),
    ).toBeInTheDocument();
    const fallback = within(card).getByRole('link', {
      name: /view this impl in the latest run/i,
    });
    expect(fallback).toHaveAttribute('href', '/impl/graphql-java');
  });

  it('renders NotFound when runId is unknown even if impl itself is unknown', async () => {
    // The impl-unknown branch runs first; we expect the "Unknown impl" 404.
    renderAt('/runs/bogus-run/impl/not-a-real-impl', makeRepo());
    expect(await screen.findByText(/unknown impl/i)).toBeInTheDocument();
  });

  it('renders the Recent runs table, highlights the current run, and navigates on row click', async () => {
    const user = userEvent.setup();
    const oldRunId = 'older-run';
    const newRunId = 'run-1';
    const repo = new FakeRepository({
      impls: [
        { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
        { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
      ],
      runs: [
        {
          id: newRunId,
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 99, failed: 1 }),
          },
        },
        {
          id: oldRunId,
          timestamp: '2026-04-20T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 40, failed: 60 }),
          },
        },
      ],
      history: {
        'graphql-java': [
          {
            runId: newRunId,
            timestamp: '2026-04-24T12:00:00Z',
            total: 100,
            passed: 99,
            failed: 1,
            errored: 0,
            falloutAfter: null,
          },
          {
            runId: oldRunId,
            timestamp: '2026-04-20T12:00:00Z',
            total: 100,
            passed: 40,
            failed: 60,
            errored: 0,
            falloutAfter: null,
          },
        ],
      },
    });
    const { container } = renderAt('/impl/graphql-java', repo);
    // Wait until the table has materialised.
    const currentRow = await screen.findByTestId(
      `runs-history-row-${newRunId}`,
    );
    expect(currentRow.className).toMatch(/is-current/);
    expect(currentRow).toHaveAttribute('aria-current', 'page');
    // Both runs render with their respective pass rates.
    expect(within(currentRow).getByText('99.0%')).toBeInTheDocument();
    const otherRow = screen.getByTestId(`runs-history-row-${oldRunId}`);
    expect(otherRow.className).not.toMatch(/is-current/);
    expect(within(otherRow).getByText('40.0%')).toBeInTheDocument();
    // Clicking the older row navigates to the pinned route for that run.
    await user.click(otherRow);
    // Wait for the pinned view to load, then assert the headline rate
    // switched to 40.0% (detail-rate specifically — the Recent runs table
    // and chart also render 40.0% elsewhere).
    await screen.findByTestId(`runs-history-row-${oldRunId}`);
    await new Promise((r) => setTimeout(r, 0));
    const detailRate = container.querySelector('.detail-rate');
    expect(detailRate?.textContent).toMatch(/40\.0%/);
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
        },
        {
          id: 'graphql-php',
          name: 'graphql-php',
          language: 'PHP',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-php'],
          excluded: 8,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 553, passed: 545 }),
            'graphql-php': implRunResults('graphql-php', { total: 545, passed: 545 }),
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
    // Non-ref denominator is corpus - excluded = 545.
    expect(
      screen.getByText(/545 total · 8 excluded · 0 failed/),
    ).toBeInTheDocument();
  });

  it('does not auto-scroll when navigating to the bare /failures route', async () => {
    // The bare /failures route no longer triggers an auto-scroll — clicking
    // "Back to failures" from a detail page (or the "Failed" meta-card link)
    // shouldn't jerk the viewport. Deep links to a specific failing test
    // (/failures/:testCaseId) still scroll that card into view.
    const user = userEvent.setup();
    const scrolled: HTMLElement[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };

    try {
      renderAt('/impl/graphql-java', makeRepo());
      await screen.findByText('graphql-java');

      const failedLabel = screen.getByText('Failed');
      const failedCard = failedLabel.closest('.detail-meta-card') as HTMLElement;
      const failedLink = within(failedCard).getByRole('link');
      expect(failedLink).toHaveAttribute('href', '/impl/graphql-java/failures');

      scrolled.length = 0;
      await user.click(failedLink);
      await new Promise((r) => setTimeout(r, 20));

      expect(scrolled).toHaveLength(0);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('renders an "aborted" note when the impl fell out, with the failure count', async () => {
    const repo = new FakeRepository({
      impls: [
        { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
        { id: 'absinthe', name: 'absinthe', language: 'Elixir' },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'absinthe'],
          excluded: 8,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 553, passed: 545 }),
            absinthe: implRunResults('absinthe', {
              total: 12, passed: 2, errored: 10, falloutAfter: 12,
            }),
          },
        },
      ],
    });
    renderAt('/impl/absinthe', repo);
    await screen.findByText('absinthe');
    expect(
      await screen.findByText(/Testing was aborted after 10 failures/i),
    ).toBeInTheDocument();
    // Pill is gone from the heading.
    expect(screen.queryByText(/^Fell out$/)).toBeNull();
  });

  it('omits the aborted note for impls that ran to completion', async () => {
    renderAt('/impl/graphql-java', makeRepo());
    await screen.findByText('graphql-java');
    expect(screen.queryByText(/Testing was aborted/i)).toBeNull();
  });

  it('renders the reference impl failure section with "Failing Tests" heading', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17'],
          excluded: 1,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 99 }),
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
    // From the reference's own POV, its failed tests are "failures" — not
    // "exclusions" (that word describes the effect on non-reference impls).
    expect(await screen.findByText('Failing Tests')).toBeInTheDocument();
    expect(screen.getByText('1 failure in this run.')).toBeInTheDocument();
    expect(screen.queryByText(/Excluded Tests/)).toBeNull();
  });
});
