import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FailureDetail } from './FailureDetail';
import { FakeRepository, implRunResults } from '../repository/FakeRepository';
import { RepositoryProvider } from '../repository/context';
import type { Result } from '../repository/types';

function mockCorpusFetch(map: Record<string, string>) {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const key = Object.keys(map).find((k) => url.endsWith(k));
      if (!key) {
        return new Response('not found', { status: 404 });
      }
      return new Response(map[key], {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    },
  );
  return spy;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const testCaseId = 'schema/query/vars';

function renderAt(initialPath: string, repo: FakeRepository) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RepositoryProvider value={repo}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="/impl/:name/failures/:testCaseId"
              element={<FailureDetail />}
            />
            <Route
              path="/runs/:runId/impl/:name/failures/:testCaseId"
              element={<FailureDetail />}
            />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </QueryClientProvider>,
  );
}

function makeRepo(): FakeRepository {
  const currentRun = 'run-1';
  const olderRun = 'run-0';
  const results: Result[] = [
    {
      id: 'java-current',
      runId: currentRun,
      implId: 'graphql-java',
      testCaseId,
      status: 'fail',
      expected: { data: { x: 1 } },
      actual: { data: { x: 2 } },
    },
    {
      id: 'go-current',
      runId: currentRun,
      implId: 'graphql-go',
      testCaseId,
      status: 'error',
      expected: { data: { x: 1 } },
      error: 'driver crashed',
    },
  ];
  return new FakeRepository({
    impls: [
      { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
      { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
      { id: 'graphql-ruby', name: 'graphql-ruby', language: 'Ruby' },
      { id: 'graphql-go', name: 'graphql-go', language: 'Go' },
    ],
    runs: [
      {
        id: currentRun,
        timestamp: '2026-04-24T12:00:00Z',
        referenceImplId: 'graphql-js-17',
        implIds: ['graphql-js-17', 'graphql-java', 'graphql-ruby', 'graphql-go'],
        excluded: 0,
        resultsByImpl: {
          'graphql-js-17': implRunResults('graphql-js-17', {
            total: 2,
            passed: 2,
          }),
          'graphql-java': implRunResults('graphql-java', {
            total: 2,
            passed: 1,
            failed: 1,
          }),
          'graphql-ruby': implRunResults('graphql-ruby', {
            total: 2,
            passed: 2,
          }),
          'graphql-go': implRunResults('graphql-go', {
            total: 2,
            passed: 1,
            errored: 1,
          }),
        },
      },
      {
        id: olderRun,
        timestamp: '2026-04-20T12:00:00Z',
        referenceImplId: 'graphql-js-17',
        implIds: ['graphql-js-17', 'graphql-java', 'graphql-ruby', 'graphql-go'],
        excluded: 0,
        resultsByImpl: {
          'graphql-js-17': implRunResults('graphql-js-17', {
            total: 2,
            passed: 2,
          }),
          'graphql-java': implRunResults('graphql-java', {
            total: 2,
            passed: 2,
          }),
          'graphql-ruby': implRunResults('graphql-ruby', {
            total: 2,
            passed: 2,
          }),
          'graphql-go': implRunResults('graphql-go', {
            total: 2,
            passed: 2,
          }),
        },
      },
    ],
    results,
  });
}

describe('FailureDetail', () => {
  it('renders expected and actual responses before historical and peer context', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );

    expect(
      await screen.findByRole('heading', { name: 'graphql-java', level: 2 }),
    ).toBeInTheDocument();

    const expected = screen
      .getByRole('heading', { name: 'Expected Response' })
      .closest('section') as HTMLElement;
    const actual = screen
      .getByRole('heading', { name: 'Actual Response' })
      .closest('section') as HTMLElement;

    // Expected side shows "<reference-impl-name> [Reference pill]" —
    // no "Reference:" prefix, and the pill is the live label.
    expect(within(expected).getByText('graphql-js-17')).toBeInTheDocument();
    expect(
      within(expected).getByText('Reference', { selector: '.reference-pill' }),
    ).toBeInTheDocument();
    expect(within(expected).queryByText(/Reference:/)).toBeNull();
    expect(within(expected).getByText('"x":')).toBeInTheDocument();
    expect(within(expected).getByText('1')).toBeInTheDocument();
    expect(within(actual).getByText('graphql-java')).toBeInTheDocument();
    expect(within(actual).getByText('"x":')).toBeInTheDocument();
    expect(within(actual).getByText('2')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'History' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 2 scored runs passed.')).toBeInTheDocument();
    expect(screen.getByTestId('test-case-history-chart')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'All Results For This Test' }),
    ).toBeInTheDocument();
    // Counts all impls including the reference: graphql-js-17 (pass),
    // graphql-java (fail, current), graphql-ruby (pass), graphql-go (error)
    // → 2 pass of 4.
    expect(screen.getByText('2 of 4 implementations passed.')).toBeInTheDocument();
  });

  it('links peer failures to their own failure detail page', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );

    const go = await screen.findByRole('link', { name: 'graphql-go' });
    expect(go).toHaveAttribute(
      'href',
      '/runs/run-1/impl/graphql-go/failures/schema%2Fquery%2Fvars',
    );

    const ruby = screen.getByRole('link', { name: 'graphql-ruby' });
    expect(ruby).toHaveAttribute('href', '/runs/run-1/impl/graphql-ruby');
  });

  it('renders NotFound when the selected test is not a failure for this impl', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/not-a-failure',
      makeRepo(),
    );
    expect(
      await screen.findByText(/did not fail for this implementation/i),
    ).toBeInTheDocument();
  });

  it('omits unscored peers from the peer table', async () => {
    // Construct a scenario where one peer fell out of testing (skipped) and
    // another was excluded upstream by the reference. Neither should render
    // as a row in the "All Results For This Test" table.
    const runId = 'run-skipped';
    const refExcluded: Result = {
      id: 'ref-excl',
      runId,
      implId: 'graphql-js-17',
      testCaseId,
      status: 'excluded',
      actual: { errors: [{ message: 'excluded upstream' }] },
    };
    const javaFail: Result = {
      id: 'j-fail',
      runId,
      implId: 'graphql-java',
      testCaseId,
      status: 'fail',
      expected: { data: { x: 1 } },
      actual: { data: { x: 2 } },
    };
    const repo = new FakeRepository({
      impls: [
        { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
        { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
        { id: 'graphql-ruby', name: 'graphql-ruby', language: 'Ruby' }, // falls out → skipped
        { id: 'graphql-go', name: 'graphql-go', language: 'Go' }, // excluded via ref
      ],
      runs: [
        {
          id: runId,
          timestamp: '2026-04-28T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java', 'graphql-ruby', 'graphql-go'],
          excluded: 1,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 2, passed: 1 }),
            'graphql-java': implRunResults('graphql-java', { total: 1, passed: 0, failed: 1 }),
            // Ruby fell out after 0 tests → status becomes 'skipped' for
            // this test case.
            'graphql-ruby': implRunResults('graphql-ruby', {
              total: 0,
              passed: 0,
              falloutAfter: 0,
            }),
            'graphql-go': implRunResults('graphql-go', { total: 1, passed: 1 }),
          },
        },
      ],
      results: [refExcluded, javaFail],
    });
    renderAt(
      `/runs/${runId}/impl/graphql-java/failures/schema%2Fquery%2Fvars`,
      repo,
    );
    const peerHeading = await screen.findByRole('heading', {
      name: 'All Results For This Test',
    });
    const peerCard = peerHeading.closest('.failure-peer-card') as HTMLElement;
    expect(peerCard).toBeTruthy();
    // No rows for skipped (ruby) or excluded (go) peers.
    expect(within(peerCard).queryByText('graphql-ruby')).toBeNull();
    expect(within(peerCard).queryByText('graphql-go')).toBeNull();
    // The summary counts the full pool — 1 scored (java: fail), 3 unscored
    // (js-17 reference: excluded, ruby: skipped, go: excluded) → "0 of 1
    // implementations passed" + the "not scored" segment surfaced in the meta.
    expect(within(peerCard).getByText('0 of 1 implementations passed.'))
      .toBeInTheDocument();
    expect(within(peerCard).getByText(/3 not scored/)).toBeInTheDocument();
    // The "NOT SCORED" pill is no longer used anywhere on the page.
    expect(document.querySelector('.status-pill-skipped')).toBeNull();
  });

  it('includes the current impl in the All Results table and highlights its row', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const peerHeading = await screen.findByRole('heading', {
      name: 'All Results For This Test',
    });
    const peerCard = peerHeading.closest('.failure-peer-card') as HTMLElement;
    // The current impl (graphql-java) appears in the table.
    expect(within(peerCard).getByText('graphql-java')).toBeInTheDocument();
    // Its row is marked aria-current and carries an `is-current` class.
    const current = within(peerCard)
      .getByText('graphql-java')
      .closest('tr') as HTMLElement;
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current.className).toMatch(/is-current/);
    // The current row is not itself a link (would self-link); the other
    // impls still get clickable links.
    expect(within(current).queryByRole('link')).toBeNull();
    expect(within(peerCard).getByRole('link', { name: 'graphql-ruby' }))
      .toBeInTheDocument();
  });

  it('omits the "not scored" meta segment when every impl was scored', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const peerHeading = await screen.findByRole('heading', {
      name: 'All Results For This Test',
    });
    const peerCard = peerHeading.closest('.failure-peer-card') as HTMLElement;
    // 4 scored / 0 unscored → no "not scored" text in the meta line.
    expect(within(peerCard).getByText(/2 passed · 2 failed/)).toBeInTheDocument();
    expect(within(peerCard).queryByText(/not scored/i)).toBeNull();
  });

  it('renders the pass-rate bar using the shared PassRateBar (same as dashboard)', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const peerHeading = await screen.findByRole('heading', {
      name: 'All Results For This Test',
    });
    const peerCard = peerHeading.closest('.failure-peer-card') as HTMLElement;
    // Same bar-container element the dashboard uses, with a percentage
    // aria-label.
    const bar = peerCard.querySelector(
      '.failure-rate-summary .bar-container',
    ) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('aria-label')).toMatch(/passing/);
  });

  it('renders the "Failed Runs" table with links to each failing run', async () => {
    // makeRepo() has graphql-java failing in run-1; it also includes run-0
    // where graphql-java passed. Only run-1 should appear in the table, and
    // that row should be marked as the current run.
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const heading = await screen.findByRole('heading', { name: 'Failed Runs' });
    const card = heading.closest('.runs-history-card') as HTMLElement;
    expect(card).toBeTruthy();
    const row = within(card).getByTestId('failure-runs-row-run-1');
    expect(row.className).toMatch(/is-current/);
    expect(row).toHaveAttribute('aria-current', 'page');
    // Only one row (run-1). The other run is a pass and is excluded.
    expect(within(card).queryAllByRole('link').length + 1).toBe(
      within(card).getAllByTestId(/^failure-runs-row-/).length + 1,
    );
    expect(within(card).getAllByTestId(/^failure-runs-row-/)).toHaveLength(1);
  });

  it('navigates to a failing run when a row in the table is clicked', async () => {
    // Add a second failing run so we have a non-current row to navigate to.
    const runId = 'run-2';
    const base = makeRepo();
    const impls = await base.listImpls();
    const runs = await base.listRuns();
    const repo = new FakeRepository({
      impls,
      runs: [
        ...runs,
        {
          id: runId,
          timestamp: '2026-04-10T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', {
              total: 2,
              passed: 2,
            }),
            'graphql-java': implRunResults('graphql-java', {
              total: 2,
              passed: 1,
              failed: 1,
            }),
          },
        },
      ],
      results: [
        {
          id: 'j-1',
          runId: 'run-1',
          implId: 'graphql-java',
          testCaseId,
          status: 'fail',
          expected: { data: { x: 1 } },
          actual: { data: { x: 2 } },
        },
        {
          id: 'j-2',
          runId,
          implId: 'graphql-java',
          testCaseId,
          status: 'fail',
          expected: { data: { x: 1 } },
          actual: { data: { x: 3 } },
        },
      ],
    });
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      repo,
    );
    const heading = await screen.findByRole('heading', { name: 'Failed Runs' });
    const card = heading.closest('.runs-history-card') as HTMLElement;
    const other = within(card).getByTestId(`failure-runs-row-${runId}`);
    expect(other.className).not.toMatch(/is-current/);
    // Row has role=link and a descriptive aria-label.
    expect(other).toHaveAttribute('role', 'link');
    expect(other.getAttribute('aria-label')).toMatch(/View failure from/);
  });

  it('renders schema, query, and variables text in the test input section', async () => {
    mockCorpusFetch({
      '/corpus/schema/schema.graphqls': 'type Query { answer: Int! }',
      '/corpus/schema/query/query.graphql': 'query { answer }',
      '/corpus/schema/query/vars/variables.json': '{"v":42}',
    });
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );

    const input = await screen.findByTestId('failure-test-input');
    expect(
      within(input).getByRole('heading', { name: /test input/i }),
    ).toBeInTheDocument();
    // Tokens split the raw text into multiple spans; read each pane's
    // combined textContent to recover what a user sees.
    await waitFor(() => {
      const panes = input.querySelectorAll('[data-testid="code-pane"]');
      expect(panes).toHaveLength(3);
      const bodyText = (p: Element) =>
        (p.querySelector('.code-pane-body') as HTMLElement).textContent;
      expect(bodyText(panes[0])).toBe('type Query { answer: Int! }');
      expect(bodyText(panes[1])).toBe('query { answer }');
      expect(bodyText(panes[2])).toBe('{"v":42}');
    });
  });

  it('highlights GraphQL keywords and JSON keys in the rendered panes', async () => {
    mockCorpusFetch({
      '/corpus/schema/schema.graphqls': 'type Query { answer: Int! }',
      '/corpus/schema/query/query.graphql': 'query Q { answer }',
      '/corpus/schema/query/vars/variables.json': '{"v":42}',
    });
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const input = await screen.findByTestId('failure-test-input');
    await waitFor(() => {
      expect(input.querySelectorAll('[data-testid="code-pane"]')).toHaveLength(3);
    });
    const panes = input.querySelectorAll('[data-testid="code-pane"]');
    // Schema pane: the `type` keyword gets the gql-keyword class.
    expect(
      within(panes[0] as HTMLElement).getByText('type'),
    ).toHaveClass('gql-keyword');
    // Variables pane: the "v": lexeme is a JSON key.
    expect(
      within(panes[2] as HTMLElement).getByText('"v":'),
    ).toHaveClass('json-key');
  });

  it('renders a copy button for each artifact and no corpus link', async () => {
    mockCorpusFetch({
      '/corpus/schema/schema.graphqls': 'type Q { a: Int }',
      '/corpus/schema/query/query.graphql': '{ a }',
      '/corpus/schema/query/vars/variables.json': '{}',
    });
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const input = await screen.findByTestId('failure-test-input');
    await waitFor(() => {
      expect(input.querySelectorAll('[data-testid="code-pane"]')).toHaveLength(3);
    });
    // One copy button per artifact pane (schema/query/variables).
    expect(within(input).getByRole('button', { name: /copy schema/i })).toBeInTheDocument();
    expect(within(input).getByRole('button', { name: /copy query/i })).toBeInTheDocument();
    expect(within(input).getByRole('button', { name: /copy variables/i })).toBeInTheDocument();
    // No links should be present in the panes — the corpus path link was
    // removed per design. (The page's top-of-header test-key still shows
    // the path as plain text, not a link, elsewhere on the page.)
    expect(within(input).queryByRole('link')).toBeNull();
  });

  it('renders copy buttons for the expected and actual response panes', async () => {
    mockCorpusFetch({});
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const expected = (await screen
      .findByRole('heading', { name: 'Expected Response' }))
      .closest('section') as HTMLElement;
    const actual = screen
      .getByRole('heading', { name: 'Actual Response' })
      .closest('section') as HTMLElement;
    expect(
      within(expected).getByRole('button', { name: /copy expected response/i }),
    ).toBeInTheDocument();
    expect(
      within(actual).getByRole('button', { name: /copy actual response/i }),
    ).toBeInTheDocument();
  });

  it('uses the updated descriptive text', async () => {
    mockCorpusFetch({});
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const input = await screen.findByTestId('failure-test-input');
    expect(
      within(input).getByText('Schema, query, and variables used in this test'),
    ).toBeInTheDocument();
  });

  it('shows the actual reference impl (not hard-coded) with a Reference pill on the Expected Response pane', async () => {
    // Build a run whose reference impl is something other than graphql-js-17
    // to prove the subtitle is data-driven.
    const repo = new FakeRepository({
      impls: [
        { id: 'alt-ref', name: 'Alternate Reference', language: 'js' },
        { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
      ],
      runs: [
        {
          id: 'run-alt',
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'alt-ref',
          implIds: ['alt-ref', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'alt-ref': implRunResults('alt-ref', { total: 1, passed: 1 }),
            'graphql-java': implRunResults('graphql-java', {
              total: 1, passed: 0, failed: 1,
            }),
          },
        },
      ],
      results: [
        {
          id: 'j',
          runId: 'run-alt',
          implId: 'graphql-java',
          testCaseId,
          status: 'fail',
          expected: { data: { x: 1 } },
          actual: { data: { x: 2 } },
        },
      ],
    });
    renderAt(
      '/runs/run-alt/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      repo,
    );
    const expected = (await screen
      .findByRole('heading', { name: 'Expected Response' }))
      .closest('section') as HTMLElement;
    // Actual reference name, not hard-coded graphql-js-17.
    expect(within(expected).getByText('Alternate Reference')).toBeInTheDocument();
    const pill = within(expected).getByText('Reference', {
      selector: '.reference-pill',
    });
    expect(pill).toBeInTheDocument();
  });

  it('renders the timestamp without bold styling', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    await screen.findByRole('heading', { name: 'graphql-java', level: 2 });
    const timestampLabel = screen.getByText('Timestamp');
    const field = timestampLabel.closest('.labeled-field') as HTMLElement;
    const value = field.querySelector('.labeled-field-value') as HTMLElement;
    expect(value.className).toMatch(/is-regular/);
    // Test Case and Run keep the default bold weight.
    const runField = screen.getByText('Run').closest('.labeled-field') as HTMLElement;
    expect(
      runField.querySelector('.labeled-field-value')?.className,
    ).not.toMatch(/is-regular/);
  });

  it('places the status pill on its own line above the impl name', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const h2 = await screen.findByRole('heading', {
      name: 'graphql-java',
      level: 2,
    });
    const head = h2.closest('.failure-detail-title-head') as HTMLElement;
    expect(head).toBeTruthy();
    const pill = head.querySelector('.status-pill');
    expect(pill).toBeTruthy();
    // The pill appears before the h2 in DOM order.
    expect(head.children[0]).toBe(pill);
    expect(head.children[1]).toBe(h2);
  });

  it('renders the run id, timestamp, and test case id as labeled fields in the title card', async () => {
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    await screen.findByRole('heading', { name: 'graphql-java', level: 2 });
    const titleCard = screen
      .getByRole('heading', { name: 'graphql-java', level: 2 })
      .closest('.failure-detail-title-card') as HTMLElement;
    // Each field rendered as a LabeledField: uppercase label + mono value.
    // The old prose sentence ("Failed on run ... at ...") is gone.
    expect(titleCard.textContent).not.toMatch(/on run/);
    expect(titleCard.textContent).not.toMatch(/corpus\//);

    const fieldLabels = Array.from(
      titleCard.querySelectorAll('.labeled-field-label'),
    ).map((el) => el.textContent);
    expect(fieldLabels).toEqual(['Test Case', 'Run', 'Timestamp']);

    // Run id + test case id values are rendered (and mono).
    expect(within(titleCard).getByText('run-1')).toBeInTheDocument();
    expect(within(titleCard).getByText('schema/query/vars')).toBeInTheDocument();
  });

  it('omits the variables block when the test case has no variables id', async () => {
    mockCorpusFetch({
      '/corpus/schema/schema.graphqls': 'type Query { x: Int }',
      '/corpus/schema/query/query.graphql': '{ x }',
    });
    const repo = makeRepo();
    // Override the result to use a 2-part testCaseId.
    const noVarsResult: Result = {
      id: 'java-novars',
      runId: 'run-1',
      implId: 'graphql-java',
      testCaseId: 'schema/query',
      status: 'fail',
      expected: { data: { x: 1 } },
      actual: { data: { x: 2 } },
    };
    // FakeRepository exposes listResults from the shared results array.
    // Re-use it by pushing through the findResult path: construct a new repo
    // whose results include a 2-part test case.
    const repoNoVars = new FakeRepository({
      impls: await repo.listImpls(),
      runs: await repo.listRuns(),
      results: [noVarsResult],
    });
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery',
      repoNoVars,
    );
    const input = await screen.findByTestId('failure-test-input');
    expect(
      await within(input).findByText(/no variables for this test case/i),
    ).toBeInTheDocument();
  });

  it('shows an error message when the corpus fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500, statusText: 'server error' }),
    );
    renderAt(
      '/runs/run-1/impl/graphql-java/failures/schema%2Fquery%2Fvars',
      makeRepo(),
    );
    const input = await screen.findByTestId('failure-test-input');
    expect(
      await within(input).findByText(/failed to load test input/i),
    ).toBeInTheDocument();
  });

  it('prefers the error message over stderr on the actual-response pane', async () => {
    const runId = 'run-err';
    const repo = new FakeRepository({
      impls: [
        { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
        { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
      ],
      runs: [
        {
          id: runId,
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 1, passed: 1 }),
            'graphql-java': implRunResults('graphql-java', {
              total: 1, passed: 0, errored: 1,
            }),
          },
        },
      ],
      results: [
        {
          id: 'e',
          runId,
          implId: 'graphql-java',
          testCaseId,
          status: 'error',
          error: 'driver crashed',
          stderr: 'noisy dump',
          expected: { data: { x: 1 } },
        },
      ],
    });
    renderAt(
      `/runs/${runId}/impl/graphql-java/failures/schema%2Fquery%2Fvars`,
      repo,
    );
    const actual = (await screen
      .findByRole('heading', { name: 'Actual Response' }))
      .closest('section') as HTMLElement;
    expect(within(actual).getByText('driver crashed')).toBeInTheDocument();
    expect(within(actual).getByText('error')).toBeInTheDocument();
    // stderr is suppressed when an error message is present.
    expect(within(actual).queryByText('stderr')).toBeNull();
    expect(within(actual).queryByText('noisy dump')).toBeNull();
  });

  it('falls back to stderr on the actual-response pane when error is absent', async () => {
    const runId = 'run-stderr-only';
    const repo = new FakeRepository({
      impls: [
        { id: 'graphql-js-17', name: 'graphql-js-17', language: 'JavaScript' },
        { id: 'graphql-java', name: 'graphql-java', language: 'Java' },
      ],
      runs: [
        {
          id: runId,
          timestamp: '2026-04-24T12:00:00Z',
          referenceImplId: 'graphql-js-17',
          implIds: ['graphql-js-17', 'graphql-java'],
          excluded: 0,
          resultsByImpl: {
            'graphql-js-17': implRunResults('graphql-js-17', { total: 1, passed: 1 }),
            'graphql-java': implRunResults('graphql-java', {
              total: 1, passed: 0, errored: 1,
            }),
          },
        },
      ],
      results: [
        {
          id: 'e',
          runId,
          implId: 'graphql-java',
          testCaseId,
          status: 'error',
          stderr: 'noisy dump',
          expected: { data: { x: 1 } },
        },
      ],
    });
    renderAt(
      `/runs/${runId}/impl/graphql-java/failures/schema%2Fquery%2Fvars`,
      repo,
    );
    const actual = (await screen
      .findByRole('heading', { name: 'Actual Response' }))
      .closest('section') as HTMLElement;
    expect(within(actual).getByText('stderr')).toBeInTheDocument();
    expect(within(actual).getByText('noisy dump')).toBeInTheDocument();
  });
});
