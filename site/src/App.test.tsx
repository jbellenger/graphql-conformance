import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { FakeRepository } from './repository/FakeRepository';
import { RepositoryProvider } from './repository/context';
import { REPO_URL } from './lib/repo';

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={new FakeRepository()}>
        <App />
      </RepositoryProvider>
    </QueryClientProvider>,
  );
}

describe('App header', () => {
  it('renders a GitHub link in the header pointing at REPO_URL', () => {
    renderApp();
    const link = screen.getByRole('link', {
      name: /view the graphql conformance project on github/i,
    });
    expect(link).toHaveAttribute('href', REPO_URL);
  });
});
