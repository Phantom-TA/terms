import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { workbenchKeys } from '../workbench/queries';

export const negotiationKeys = {
  deals: ['deals'] as const,
  audit: (dealId: string) => ['deal-audit', dealId] as const,
};

export function useDeals() {
  return useQuery({ queryKey: negotiationKeys.deals, queryFn: () => api('listDeals', {}) });
}

/** The deal's audit entries, newest first. PayPal calls and webhooks are drawn from these. */
export function useDealAudit(dealId: string) {
  return useQuery({
    queryKey: negotiationKeys.audit(dealId),
    queryFn: () => api('listAudit', { query: { dealId, limit: 200 } }),
  });
}

export interface DecideVariables {
  approvalId: string;
  dealId: string | null;
  decision: 'APPROVED' | 'REJECTED';
}

/** Decides a pending approval. Everything it could change is fetched again before it settles. */
export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, decision }: DecideVariables) =>
      api('decideApproval', { params: { approvalId }, body: { decision } }),
    onSuccess: async (_result, { dealId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: negotiationKeys.deals }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.goal }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.runway }),
        ...(dealId
          ? [
              queryClient.invalidateQueries({ queryKey: workbenchKeys.deal(dealId) }),
              queryClient.invalidateQueries({ queryKey: negotiationKeys.audit(dealId) }),
            ]
          : []),
      ]);
    },
  });
}
