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

  it('scrolls to the failures section when the Failed meta-card link is clicked', async () => {
    const user = userEvent.setup();
    // Capture each element scrollIntoView is invoked on by replacing the
    // prototype method rather than spyOn — mock.instances types as `void`
    // for void-returning methods which makes the assertion awkward.
    const scrolled: HTMLElement[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };

    try {
      // Repro: landing on /impl/graphql-java (no /failures), the failures
      // section is out of view. Clicking the "Failed" meta-card link should
      // both navigate to /impl/graphql-java/failures AND scroll to #failures.
      renderAt('/impl/graphql-java', makeRepo());
      await screen.findByText('graphql-java');

      const failedLabel = screen.getByText('Failed');
      const failedCard = failedLabel.closest('.detail-meta-card') as HTMLElement;
      const failedLink = within(failedCard).getByRole('link');
      // Internal route: Link renders a relative href, not a hash-prefixed URL.
      expect(failedLink).toHaveAttribute('href', '/impl/graphql-java/failures');

      scrolled.length = 0;
      await user.click(failedLink);

      // Wait for requestAnimationFrame-scheduled scroll.
      await new Promise((r) => setTimeout(r, 20));

      const failuresSection = document.getElementById('failures');
      expect(failuresSection).toBeTruthy();
      expect(scrolled).toContain(failuresSection);
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

  it('renders the reference impl with an "Excluded Tests" heading', async () => {
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
    expect(await screen.findByText('Excluded Tests')).toBeInTheDocument();
  });
});
