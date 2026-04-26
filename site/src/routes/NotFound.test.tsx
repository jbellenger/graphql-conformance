import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFound } from './NotFound';

function renderNF(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('NotFound', () => {
  it('renders the sad-face icon and a default fallback to /', () => {
    renderNF(<NotFound />);
    const card = screen.getByTestId('not-found');
    // Icon: the <img> with alt="" is aria-hidden via its wrapper, so match
    // by role in the image-specific role instead.
    const img = card.querySelector('img.not-found-art-img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toMatch(/icons\/sad-face\.svg$/);
    // Default fallback: "Back to the dashboard" → "/"
    const link = within(card).getByRole('link', { name: /back to the dashboard/i });
    expect(link).toHaveAttribute('href', '/');
  });

  it('uses the provided message and fallback list', () => {
    renderNF(
      <NotFound
        message="That run isn't in the index."
        fallbacks={[
          { label: 'View the latest run', to: '/' },
          { label: 'View this impl in the latest run', to: '/impl/graphql-java' },
        ]}
      />,
    );
    expect(screen.getByText("That run isn't in the index.")).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /view the latest run/i }),
    ).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('link', {
        name: /view this impl in the latest run/i,
      }),
    ).toHaveAttribute('href', '/impl/graphql-java');
  });

  it('renders no fallback links when fallbacks=[]', () => {
    renderNF(
      <NotFound message="Failed to load conformance data." fallbacks={[]} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
