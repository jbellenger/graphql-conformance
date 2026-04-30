import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CodePane } from './CodePane';

describe('CodePane', () => {
  it('renders each source line as a code-line row and preserves the content', () => {
    render(
      <CodePane header="Expected" text={'line 1\nline 2\nline 3'} language="json" />,
    );
    const pane = screen.getByTestId('code-pane');
    const lines = pane.querySelectorAll('.code-line');
    expect(lines).toHaveLength(3);
    // Re-assemble just the code cells (excludes the line-number gutter).
    const content = Array.from(pane.querySelectorAll('.code-line-content'))
      .map((el) => el.textContent)
      .join('');
    expect(content).toBe('line 1line 2line 3');
  });

  it('renders a line-number gutter with one number per line', () => {
    render(
      <CodePane header="H" text={'a\nb\nc'} language="json" />,
    );
    const pane = screen.getByTestId('code-pane');
    const numbers = Array.from(pane.querySelectorAll('.code-line-number')).map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(['1', '2', '3']);
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

  it('applies the scrollable class on the body when scrollable=true', () => {
    const { rerender } = render(
      <CodePane header="H" text="" language="json" scrollable />,
    );
    const body = screen
      .getByTestId('code-pane')
      .querySelector('.code-pane-body') as HTMLElement;
    expect(body.className).toMatch(/is-scrollable/);
    rerender(<CodePane header="H" text="" language="json" />);
    expect(
      (screen.getByTestId('code-pane').querySelector(
        '.code-pane-body',
      ) as HTMLElement).className,
    ).not.toMatch(/is-scrollable/);
  });

  it('highlights tokens per language (graphql keywords, json property keys)', () => {
    const { rerender, container } = render(
      <CodePane header="S" text="type Query" language="graphql" />,
    );
    const gqlKeyword = Array.from(
      container.querySelectorAll('.token.keyword'),
    ).find((el) => el.textContent === 'type');
    expect(gqlKeyword).toBeTruthy();

    rerender(<CodePane header="V" text='{"v":1}' language="json" />);
    const jsonKey = Array.from(
      container.querySelectorAll('.token.property'),
    ).find((el) => el.textContent === '"v"');
    expect(jsonKey).toBeTruthy();
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
    expect(pane.querySelectorAll('.code-line')).toHaveLength(3);
  });
});
