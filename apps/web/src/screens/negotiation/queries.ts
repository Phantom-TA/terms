import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

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
