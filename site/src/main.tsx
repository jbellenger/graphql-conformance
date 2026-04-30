import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { RepositoryProvider } from './repository/context';
import { StaticJsonRepository } from './repository/StaticJsonRepository';
import { normalizeBootstrapUrl } from './lib/spaRedirect';
import './styles/globals.css';

normalizeBootstrapUrl(window, import.meta.env.BASE_URL);

const repository = new StaticJsonRepository(`${import.meta.env.BASE_URL}data/`);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repository}>
        <App />
      </RepositoryProvider>
    </QueryClientProvider>
  </StrictMode>,
);
