import { type Actor, type AuditAction, type ListAuditResponse } from '@terms/shared';
import { type InfiniteData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useServerEvent } from '../../api/StreamProvider';
import { useApplyEvent } from '../../api/useApplyEvent';

export interface AuditFilters {
  actor: Actor | null;
  action: AuditAction | null;
}

const PAGE = 100;

export const auditKey = (filters: AuditFilters) =>
  ['audit', filters.actor, filters.action] as const;

/** The audit trail, newest first, a page at a time. */
export function useAudit(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKey(filters),
    queryFn: ({ pageParam }) =>
      api('listAudit', {
        query: {
          limit: PAGE,
          ...(filters.actor ? { actor: filters.actor } : {}),
          ...(filters.action ? { action: filters.action } : {}),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** New entries appear at the top as they are written, if they match what is shown. */
export function useAuditLive(filters: AuditFilters): void {
  const applyEvent = useApplyEvent();
  useServerEvent('audit.appended', (event) => {
    const { entry } = event.data;
    if (filters.actor && entry.actor !== filters.actor) return;
    if (filters.action && entry.action !== filters.action) return;
    applyEvent<InfiniteData<ListAuditResponse, string | null>>(auditKey(filters), (old) => {
      const first = old?.pages[0];
      if (!old || !first || old.pages.some((p) => p.entries.some((e) => e.id === entry.id))) {
        return old;
      }
      return {
        ...old,
        pages: [{ ...first, entries: [entry, ...first.entries] }, ...old.pages.slice(1)],
      };
    });
  });
}
