import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useServerEvent } from '../../api/StreamProvider';
import { workbenchKeys } from '../workbench/queries';

export const connectionKey = ['connection'] as const;

export function useConnection() {
  return useQuery({ queryKey: connectionKey, queryFn: () => api('getConnection') });
}

/** Imports from PayPal. The counts shown afterwards are the server's. */
export function useSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('sync', { body: {} }),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionKey }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.runway }),
      ]);
    },
  });
}

export function useConnectionLive(): void {
  const queryClient = useQueryClient();
  useServerEvent('sync.completed', () => {
    void queryClient.invalidateQueries({ queryKey: connectionKey });
  });
}
