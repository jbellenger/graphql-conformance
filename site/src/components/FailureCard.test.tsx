import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('renders a single-column response for an excluded result', () => {
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
  });

  it('shows error message as summary and stderr block for error status', () => {
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
    expect(screen.getByText('Maximum call stack size exceeded')).toBeInTheDocument();
    expect(screen.getByText('stderr')).toBeInTheDocument();
  });

  it('toggles expand when clicked on an expandable card', async () => {
    const user = userEvent.setup();
    // Construct an actual response with many lines to force expandability.
    const manyErrors = Array.from({ length: 12 }, (_, i) => ({ message: `err${i}` }));
    const result: Result = {
      id: 'r',
      runId: 'run',
      implId: 'graphql-js-17',
      testCaseId: 'a/b/c',
      status: 'excluded',
      actual: { errors: manyErrors },
    };
    render(<FailureCard result={result} />);
    const card = screen.getByTestId('failure-card');
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Expand')).toBeInTheDocument();
    await user.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });
});
