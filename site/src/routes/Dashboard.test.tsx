import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
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

// Renders Dashboard plus a stub detail route so navigation is observable.
function renderWithRoutes(repository: Repository) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repository}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route
              path="/impl/:name"
              element={<div data-testid="detail-marker">detail-marker</div>}
            />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </QueryClientProvider>,
  );
}

function rowIds(): string[] {
  return screen
    .getAllByTestId(/^dashboard-row-/)
    .map((el) => el.getAttribute('data-testid')!.replace('dashboard-row-', ''));
}

describe('Dashboard', () => {
  it('renders the reference impl card and non-reference rows from Repository data', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          version: '17.0.0-alpha.14',
          repoUrl: 'https://github.com/graphql/graphql-js',
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
          id: '00000000-0000-0000-0000-000000000001',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 2,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 98 }),
            'graphql-java': implRunResults('graphql-java', { total: 98, passed: 95, failed: 3 }),
          },
        },
      ],
    });

    renderWith(repo);

    expect(await screen.findByText(/reference/i)).toBeInTheDocument();
    // graphql-java row shows up.
    expect(
      await screen.findByTestId('dashboard-row-graphql-java'),
    ).toBeInTheDocument();
    // Reference pass rate: 98/100 = 98.0%
    expect(await screen.findByText(/98\.0%/)).toBeInTheDocument();
    // graphql-java: 95/98 = 96.9% (denominator is non-excluded corpus)
    expect(await screen.findByText(/96\.9%/)).toBeInTheDocument();
  });

  it('explains that the reference\'s failures are excluded from conformance testing', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          version: '17.0.0-alpha.14',
        },
        {
          id: 'graphql-java',
          name: 'graphql-java',
          language: 'Java',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 8,
          resultsByImpl: {
            // Reference couldn't compute 8 tests → those are its "failures".
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 92 }),
            'graphql-java': implRunResults('graphql-java', { total: 92, passed: 92 }),
          },
        },
      ],
    });
    renderWith(repo);
    expect(
      await screen.findByText(
        /Failing tests are excluded from conformance testing/i,
      ),
    ).toBeInTheDocument();
  });

  it('omits the failures-excluded note when the reference has no failures', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'ref',
          name: 'ref',
          language: 'JS',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'ref',
          implIds: ['ref'],
          excluded: 0,
          resultsByImpl: {
            ref: implRunResults('ref', { total: 100, passed: 100 }), // zero failures / exclusions
          },
        },
      ],
    });
    renderWith(repo);
    // "Reference" pill renders as exact text (the ResultsTable also contains
    // the substring "reference" in "non-reference", which would otherwise
    // trip findByText/i). Match the pill specifically.
    await screen.findByText('Reference');
    expect(
      screen.queryByText(
        /Failing tests are excluded from conformance testing/i,
      ),
    ).toBeNull();
  });

  it('renders a friendly empty state when there is no latest run', async () => {
    const repo = new FakeRepository({ impls: [], runs: [] });
    renderWith(repo);
    expect(
      await screen.findByText(/no conformance data/i),
    ).toBeInTheDocument();
  });

  it('sorts non-reference impls by descending pass rate', async () => {
    const repo = new FakeRepository({
      impls: [
        { id: 'ref', name: 'ref', language: 'JS' },
        { id: 'low', name: 'low', language: 'JS' },
        { id: 'high', name: 'high', language: 'JS' },
        { id: 'mid', name: 'mid', language: 'JS' },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'ref',
          implIds: ['ref', 'low', 'high', 'mid'],
          excluded: 0,
          resultsByImpl: {
            ref: implRunResults('ref', { total: 100, passed: 100 }),
            low: implRunResults('low', { total: 100, passed: 50, failed: 50 }),
            high: implRunResults('high', { total: 100, passed: 100 }),
            mid: implRunResults('mid', { total: 100, passed: 80, failed: 20 }),
          },
        },
      ],
    });
    renderWith(repo);
    await screen.findAllByTestId(/^dashboard-row-/);
    expect(rowIds()).toEqual(['high', 'mid', 'low']);
  });

  it('breaks pass-rate ties alphabetically on impl name', async () => {
    // All three non-ref impls tied at 100%; expect order charlie, alpha, bravo
    // to be reordered to alpha, bravo, charlie.
    const repo = new FakeRepository({
      impls: [
        { id: 'ref', name: 'ref', language: 'JS' },
        { id: 'charlie', name: 'charlie', language: 'JS' },
        { id: 'alpha', name: 'alpha', language: 'JS' },
        { id: 'bravo', name: 'bravo', language: 'JS' },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'ref',
          implIds: ['ref', 'charlie', 'alpha', 'bravo'],
          excluded: 0,
          resultsByImpl: {
            ref: implRunResults('ref', { total: 100, passed: 100 }),
            alpha: implRunResults('alpha', { total: 100, passed: 100 }),
            bravo: implRunResults('bravo', { total: 100, passed: 100 }),
            charlie: implRunResults('charlie', { total: 100, passed: 100 }),
          },
        },
      ],
    });
    renderWith(repo);
    await screen.findAllByTestId(/^dashboard-row-/);
    expect(rowIds()).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('navigates to the impl detail when a row body is clicked', async () => {
    const user = userEvent.setup();
    const repo = new FakeRepository({
      impls: [
        { id: 'ref', name: 'ref', language: 'JS' },
        {
          id: 'graphql-java',
          name: 'graphql-java',
          language: 'Java',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'ref',
          implIds: ['ref', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            ref: implRunResults('ref', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 95, failed: 5 }),
          },
        },
      ],
    });
    renderWithRoutes(repo);
    const row = await screen.findByTestId('dashboard-row-graphql-java');
    // Click the pass-rate cell (non-anchor area) to exercise the row-level
    // click handler, not the inner <Link>.
    const cell = row.querySelector('.pass-rate-cell') as HTMLElement;
    await user.click(cell);
    expect(await screen.findByTestId('detail-marker')).toBeInTheDocument();
  });

  it('navigates when Enter is pressed on a focused row', async () => {
    const user = userEvent.setup();
    const repo = new FakeRepository({
      impls: [
        { id: 'ref', name: 'ref', language: 'JS' },
        {
          id: 'graphql-java',
          name: 'graphql-java',
          language: 'Java',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'ref',
          implIds: ['ref', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            ref: implRunResults('ref', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 95, failed: 5 }),
          },
        },
      ],
    });
    renderWithRoutes(repo);
    const row = await screen.findByTestId('dashboard-row-graphql-java');
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('detail-marker')).toBeInTheDocument();
  });

  it('presents the impl name as plain text and the version as an external link', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          version: '17.0.0-alpha.14',
          versionUrl:
            'https://github.com/graphql/graphql-js/releases/tag/v17.0.0-alpha.14',
        },
        {
          id: 'graphql-java',
          name: 'graphql-java',
          language: 'Java',
          version: '25.0',
          versionUrl:
            'https://github.com/graphql-java/graphql-java/releases/tag/v25.0',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 100 }),
            'graphql-java': implRunResults('graphql-java', { total: 100, passed: 95, failed: 5 }),
          },
        },
      ],
    });
    renderWith(repo);
    // Wait for render.
    await screen.findByTestId('dashboard-row-graphql-java');

    // Reference card: name is NOT an anchor; version IS an anchor to source.
    const refCard = screen.getByRole('link', {
      name: /View graphql-js-17 details/i,
    });
    // There should be no nested link for the impl name itself.
    expect(
      within(refCard).queryByRole('link', { name: 'graphql-js-17' }),
    ).toBeNull();
    const refVersionLink = within(refCard).getByRole('link', {
      name: '17.0.0-alpha.14',
    });
    expect(refVersionLink).toHaveAttribute(
      'href',
      'https://github.com/graphql/graphql-js/releases/tag/v17.0.0-alpha.14',
    );

    // Row: same pattern — name is plain text, version is a link.
    const row = screen.getByTestId('dashboard-row-graphql-java');
    expect(
      within(row).queryByRole('link', { name: 'graphql-java' }),
    ).toBeNull();
    const rowVersionLink = within(row).getByRole('link', {
      name: '25.0',
    });
    expect(rowVersionLink).toHaveAttribute(
      'href',
      'https://github.com/graphql-java/graphql-java/releases/tag/v25.0',
    );
  });

  it('renders a separate "Last run" card below the reference card', async () => {
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          version: '17.0.0-alpha.14',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 100 }),
          },
        },
      ],
    });
    const { container } = renderWith(repo);
    const lastRun = await screen.findByLabelText('Last conformance run');
    expect(within(lastRun).getByText('Last run')).toBeInTheDocument();
    // "Last run" card is outside the reference card (separate .card).
    const refCard = container.querySelector('.reference-card');
    expect(refCard).toBeTruthy();
    expect(refCard!.contains(lastRun)).toBe(false);
  });

  it('navigates to the reference impl when the reference card is clicked', async () => {
    const user = userEvent.setup();
    const repo = new FakeRepository({
      impls: [
        {
          id: 'graphql-js-17',
          name: 'graphql-js-17',
          language: 'JavaScript',
          version: '17.0.0-alpha.14',
        },
      ],
      runs: [
        {
          id: 'r',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17'],
          excluded: 2,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 100, passed: 98 }),
          },
        },
      ],
    });
    renderWithRoutes(repo);
    const card = await screen.findByRole('link', {
      name: /View graphql-js-17 details/i,
    });
    // Click on a non-link child of the card (the pass-rate number).
    const rate = card.querySelector('.reference-rate') as HTMLElement;
    await user.click(rate);
    expect(await screen.findByTestId('detail-marker')).toBeInTheDocument();
  });
});
