import { createContext, useContext, type ReactNode } from 'react';
import type { Repository } from './Repository';

const RepositoryContext = createContext<Repository | null>(null);

export function RepositoryProvider({
  value,
  children,
}: {
  value: Repository;
  children: ReactNode;
}) {
  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}

export function useRepository(): Repository {
  const repo = useContext(RepositoryContext);
  if (!repo) throw new Error('useRepository must be used inside RepositoryProvider');
  return repo;
}
