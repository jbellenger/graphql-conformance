import { useQuery } from '@tanstack/react-query';
import { useRepository } from './context';
import type { ResultFilter } from './Repository';

export function useImpls() {
  const repo = useRepository();
  return useQuery({
    queryKey: ['impls'],
    queryFn: () => repo.listImpls(),
  });
}

export function useImpl(id: string) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['impl', id],
    queryFn: () => repo.getImpl(id),
  });
}

export function useLatestRun() {
  const repo = useRepository();
  return useQuery({
    queryKey: ['run', 'latest'],
    queryFn: () => repo.getLatestRun(),
  });
}

export function useRun(id: string | undefined) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => (id ? repo.getRun(id) : null),
    enabled: id != null,
  });
}

export function useResults(filter: ResultFilter) {
  const repo = useRepository();
  return useQuery({
    queryKey: ['results', filter],
    queryFn: () => repo.listResults(filter),
    enabled: filter.runId != null && filter.implId != null,
  });
}
