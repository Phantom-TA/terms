import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Folds a server event into cached data. A fetch already in flight may have started before the
 * event, so its answer could be older; in that case refetch, which replaces that fetch with one
 * that includes the event.
 */
export function useApplyEvent() {
  const queryClient = useQueryClient();
  return useCallback(
    <T>(queryKey: QueryKey, update: (old: T | undefined) => T | undefined) => {
      const refreshing = queryClient.isFetching({ queryKey }) > 0;
      queryClient.setQueryData<T>(queryKey, update);
      if (refreshing) void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient],
  );
}
