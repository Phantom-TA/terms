import { type DealDetail, isFinal } from '@terms/shared';

/**
 * Why a closed deal closed, in the viewing side's words. Its own history carries its own reason
 * for a move it made; closedReason is the public one both sides read ("Declined"), which says no
 * more than the state, so it is left out when that is all there is.
 */
export function closingReason(deal: DealDetail): string | null {
  if (!isFinal(deal.state)) return null;
  const reason = deal.history.findLast((h) => h.to === deal.state)?.reason ?? deal.closedReason;
  if (!reason) return null;
  const plain = (text: string) => text.toLowerCase().replaceAll(/[^a-z]/g, '');
  return plain(reason) === plain(deal.state) ? null : reason;
}
