import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from './Dashboard';
import { FakeRepository, implRunResults } from '../repository/FakeRepository';
import { RepositoryProvider } from '../repository/context';
import type { Repository } from '../repository/Repository';

function renderWith(repository: Repository) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repository}>
        <HashRouter>
          <Dashboard />
        </HashRouter>
      </RepositoryProvider>
    </QueryClientProvider>,
  );
}

describe('Dashboard', () => {
  it('renders the reference impl card and non-reference rows from Repository data', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          isReference: true,
          version: '17.0.0-alpha.14',
          repoUrl: 'https://github.com/graphql/graphql-js',
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
          id: '00000000-0000-0000-0000-000000000001',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          testCaseCount: 100,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { excluded: 2 }),
            'graphql-java': implRunResults('graphql-java', { failed: 3 }),
          },
        },
      ],
    });

    renderWith(repo);

    // Reference pill is rendered once (for the reference impl).
    expect(await screen.findByText(/reference/i)).toBeInTheDocument();
    // Reference impl name appears as a link.
    expect(
      await screen.findByRole('link', { name: /graphql-js-17/ }),
    ).toBeInTheDocument();
    // Non-reference impl appears in the table as a link.
    expect(
      await screen.findByRole('link', { name: 'graphql-java' }),
    ).toBeInTheDocument();
    // Reference pass rate: 100 - 2 excluded = 98 passed => 98.0%
    expect(await screen.findByText(/98\.0%/)).toBeInTheDocument();
    // graphql-java: 100 - 3 failed = 97 passed => 97.0%
    expect(await screen.findByText(/97\.0%/)).toBeInTheDocument();
  });

  it('renders a friendly empty state when there is no latest run', async () => {
    const repo = new FakeRepository({ impls: [], runs: [] });
    renderWith(repo);
    expect(
      await screen.findByText(/no conformance data/i),
    ).toBeInTheDocument();
  });
});
