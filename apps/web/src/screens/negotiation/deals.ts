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

/**
 * The conversation to open when the owner hasn't chosen one. It stays put while live updates
 * reorder the list, and moves only to something that needs the owner.
 */
export function nextAutoDealId(
  deals: readonly DealSummary[],
  previous: string | null,
): string | null {
  const current = deals.find((deal) => deal.id === previous);
  if (current?.state === 'NEEDS_OWNER') return current.id;
  return (
    deals.find((deal) => deal.state === 'NEEDS_OWNER')?.id ?? current?.id ?? deals[0]?.id ?? null
  );
}

/** The deal the address names, if it is still in the list, otherwise the automatic one. */
export function selectedDealId(
  deals: readonly DealSummary[],
  requested: string | null,
  auto: string | null,
): string | null {
  return requested && deals.some((deal) => deal.id === requested) ? requested : auto;
}
