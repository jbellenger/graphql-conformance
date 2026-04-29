import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FailureCard } from './FailureCard';
import type { Result } from '../repository/types';

function failResult(overrides: Partial<Result> = {}): Result {
  return {
    id: 'result-id',
    runId: 'run-id',
    implId: 'graphql-java',
    testCaseId: 'aaaa/bbbb/cccc',
    status: 'fail',
    expected: { data: { hello: 'world' } },
    actual: { data: { hello: 'worlds' } },
    ...overrides,
  };
}

describe('FailureCard', () => {
  it('renders a diff for a fail status (expected vs actual)', () => {
    render(<FailureCard result={failResult()} />);
    expect(screen.getAllByText('Expected').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Actual').length).toBeGreaterThan(0);
  });

  it('renders the canonical test case id without a "corpus/" prefix and no copy button next to it', () => {
    render(<FailureCard result={failResult()} />);
    const card = screen.getByTestId('failure-card');
    const value = card.querySelector('.labeled-field-value') as HTMLElement;
    expect(value.textContent).toBe('aaaa/bbbb/cccc');
    // No "corpus/" prefix and no copy button inside the labeled field.
    expect(value.textContent).not.toMatch(/corpus\//);
    const field = value.closest('.labeled-field') as HTMLElement;
    expect(within(field).queryByRole('button')).toBeNull();
  });

  it('does not render "Output differs" or an expand/collapse chip', () => {
    render(<FailureCard result={failResult()} />);
    expect(screen.queryByText(/output differs/i)).toBeNull();
    expect(screen.queryByText(/^Expand$/)).toBeNull();
    expect(screen.queryByText(/^Collapse$/)).toBeNull();
  });

  it('renders copy buttons for the expected and actual diff panes', () => {
    render(<FailureCard result={failResult()} />);
    expect(
      screen.getByRole('button', { name: /copy expected response/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /copy actual response/i }),
    ).toBeInTheDocument();
  });

  it('renders a single-column response for an excluded result with a copy button', () => {
    const result: Result = {
      id: 'r',
      runId: 'run',
      implId: 'graphql-js-17',
      testCaseId: 'a/b/c',
      status: 'excluded',
      actual: {
        errors: [{ message: 'Excluded: @defer misuse' }],
      },
    };
    render(<FailureCard result={result} />);
    expect(screen.getByText('Response')).toBeInTheDocument();
    expect(screen.queryByText('Expected')).toBeNull();
    expect(
      screen.getByRole('button', { name: /copy response/i }),
    ).toBeInTheDocument();
  });

  it('prefers the error message over stderr when both are present', () => {
    const result: Result = {
      id: 'r',
      runId: 'run',
      implId: 'graphql-js-16',
      testCaseId: 'a/b/c',
      status: 'error',
      error: 'Maximum call stack size exceeded',
      stderr: 'oh\nno\nstack overflow',
    };
    render(<FailureCard result={result} />);
    expect(
      screen.getByText('Maximum call stack size exceeded'),
    ).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    // stderr is suppressed when error already summarises the failure.
    expect(screen.queryByText('stderr')).toBeNull();
    expect(screen.queryByText(/oh\nno\nstack overflow/)).toBeNull();
  });

  it('falls back to stderr when error is absent', () => {
    const result: Result = {
      id: 'r',
      runId: 'run',
      implId: 'graphql-js-16',
      testCaseId: 'a/b/c',
      status: 'error',
      stderr: 'oh\nno\nstack overflow',
    };
    render(<FailureCard result={result} />);
    expect(screen.getByText('stderr')).toBeInTheDocument();
    expect(screen.getByText(/oh/)).toBeInTheDocument();
  });

  it('renders a Details link when detailTo is provided', () => {
    render(
      <MemoryRouter>
        <FailureCard
          result={failResult()}
          detailTo="/runs/run-1/impl/graphql-java/failures/aaaa%2Fbbbb%2Fcccc"
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', {
      name: /view failure detail for aaaa\/bbbb\/cccc/i,
    });
    expect(link).toHaveAttribute(
      'href',
      '/runs/run-1/impl/graphql-java/failures/aaaa%2Fbbbb%2Fcccc',
    );
  });
});
