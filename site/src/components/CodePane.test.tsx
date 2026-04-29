import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CodePane } from './CodePane';

describe('CodePane', () => {
  it('renders each line of the text as a JSON-diff-line row', () => {
    render(
      <CodePane header="Expected" text={'line 1\nline 2\nline 3'} language="json" />,
    );
    const pane = screen.getByTestId('code-pane');
    const lines = pane.querySelectorAll('.json-diff-line');
    expect(lines).toHaveLength(3);
    // Combined text content reassembles the source (tokens live inline).
    const body = pane.querySelector('.code-pane-body') as HTMLElement;
    expect(body.textContent).toBe('line 1line 2line 3');
  });

  it('tags the container with data-language', () => {
    const { rerender } = render(
      <CodePane header="S" text="type Q" language="graphql" />,
    );
    expect(screen.getByTestId('code-pane').getAttribute('data-language'))
      .toBe('graphql');
    rerender(<CodePane header="V" text="{}" language="json" />);
    expect(screen.getByTestId('code-pane').getAttribute('data-language'))
      .toBe('json');
  });

  it('renders actions in the header when provided', () => {
    render(
      <CodePane
        header="Expected"
        text="{}"
        language="json"
        actions={<button type="button">copy</button>}
      />,
    );
    const header = screen.getByTestId('code-pane').querySelector(
      '.code-pane-header',
    ) as HTMLElement;
    expect(within(header).getByRole('button', { name: 'copy' }))
      .toBeInTheDocument();
  });

  it('applies the scrollable class when scrollable=true', () => {
    const { rerender } = render(
      <CodePane header="H" text="" language="json" scrollable />,
    );
    expect(screen.getByTestId('code-pane').className).toMatch(
      /json-diff-scrollable/,
    );
    rerender(<CodePane header="H" text="" language="json" />);
    expect(screen.getByTestId('code-pane').className).not.toMatch(
      /json-diff-scrollable/,
    );
  });

  it('highlights tokens per language (graphql keywords, json keys)', () => {
    const { rerender, container } = render(
      <CodePane header="S" text="type Query" language="graphql" />,
    );
    // GraphQL keyword class.
    expect(container.querySelector('.gql-keyword')?.textContent).toBe('type');

    rerender(<CodePane header="V" text='"v":1' language="json" />);
    expect(container.querySelector('.json-key')?.textContent).toBe('"v":');
  });

  it('truncates to maxRows when provided', () => {
    render(
      <CodePane
        header="H"
        text={'a\nb\nc\nd\ne'}
        language="json"
        maxRows={3}
      />,
    );
    const pane = screen.getByTestId('code-pane');
    expect(pane.querySelectorAll('.json-diff-line')).toHaveLength(3);
  });
});
