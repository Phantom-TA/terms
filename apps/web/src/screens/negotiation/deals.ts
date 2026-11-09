import { type DealSummary, isFinal } from '@terms/shared';

/** Deals that are a conversation. A reminder has nothing to negotiate. */
export function negotiableDeals(deals: readonly DealSummary[]): DealSummary[] {
  return deals.filter((deal) => deal.action !== 'REMINDER' && deal.action !== 'NONE');
}

function rank(deal: DealSummary): number {
  if (deal.state === 'NEEDS_OWNER') return 0;
  return isFinal(deal.state) ? 2 : 1;
}

/** What needs the owner first, then what is moving, then what has closed. */
export function sortDeals(deals: readonly DealSummary[]): DealSummary[] {
  return [...deals].sort(
    (a, b) =>
      rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}

/** The deal the URL names, if it is still in the list, otherwise the most pressing one. */
export function selectedDealId(
  deals: readonly DealSummary[],
  requested: string | null,
): string | null {
  if (requested && deals.some((deal) => deal.id === requested)) return requested;
  return deals[0]?.id ?? null;
}
