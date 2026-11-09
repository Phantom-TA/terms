import { type SessionResponse } from '@terms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { isUnauthenticated } from '../api/errors';

export const sessionQueryKey = ['session'] as const;
export const businessesQueryKey = ['businesses'] as const;

async function fetchSession(): Promise<SessionResponse | null> {
  try {
    return await api('getSession');
  } catch (error) {
    if (isUnauthenticated(error)) return null;
    throw error;
  }
}

/** The current demo session; `data` is null when no business has been chosen. */
export function useSession() {
  return useQuery({ queryKey: sessionQueryKey, queryFn: fetchSession });
}

export function useBusinesses() {
  return useQuery({
    queryKey: businessesQueryKey,
    queryFn: async () => (await api('listBusinesses')).businesses,
  });
}

/** Starts a session as another business and drops every cached record from the previous one. */
export function useSwitchSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (businessId: string) => api('createSession', { body: { businessId } }),
    onSuccess: (session) => {
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey[0] !== sessionQueryKey[0] && query.queryKey[0] !== businessesQueryKey[0],
      });
      queryClient.setQueryData(sessionQueryKey, session);
    },
  });
}

/** The environment label to show before a session exists. Failure just means no label yet. */
export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => api('health'), retry: false });
}
