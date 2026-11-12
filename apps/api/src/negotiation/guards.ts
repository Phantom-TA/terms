/**
 * The checks every negotiator move must pass before it takes effect, whoever chose it: the
 * deterministic strategies or a language model. A move that fails throws POLICY_BLOCKED and has no
 * effect. These are pure, so an AI negotiator can run the same checks on its own answer and fall
 * back to the deterministic move instead of failing the turn.
 */
import { isBlocked } from '@terms/shared';
import { policyBlocked } from '../errors.js';
import {
  type ClientMove,
  type ClientView,
  clientChecks,
  type SupplierMove,
  type SupplierView,
  supplierChecks,
  type Terms,
} from './strategies.js';

export const sameTerms = (a: Terms, b: Terms): boolean =>
  a.amountEarly === b.amountEarly &&
  a.discountBps === b.discountBps &&
  a.payBy === b.payBy &&
  a.remainderDue === b.remainderDue;

/** Checks a client move against the client's own policy before it takes effect. */
export function guardClientMove(
  view: ClientView,
  offer: Terms,
  round: number,
  move: ClientMove,
): void {
  if (move.type === 'DECLINE') return;
  if (move.type === 'ACCEPT') {
    if (!sameTerms(move.terms, offer))
      throw policyBlocked('An accept must accept the offer as made', []);
    const checks = clientChecks(view, offer, round);
    if (isBlocked(checks)) throw policyBlocked('Accepting breaks the client policy', checks);
    return;
  }
  const checks = clientChecks(view, move.terms, round + 1);
  if (
    isBlocked(checks) ||
    move.terms.amountEarly > view.invoiceDue ||
    move.terms.amountEarly <= 0n
  ) {
    throw policyBlocked('The counter breaks the client policy', checks);
  }
}

/** Checks a supplier move against the owner's policy before it takes effect. */
export function guardSupplierMove(
  view: SupplierView,
  counter: Terms,
  round: number,
  move: SupplierMove,
): void {
  if (move.type === 'DECLINE') return;
  const moveRound =
    move.type === 'COUNTER' || (move.type === 'NEEDS_OWNER' && move.onApproval === 'COUNTER')
      ? round + 1
      : round;
  const checks = supplierChecks(view, move.terms, moveRound);
  if (isBlocked(checks)) throw policyBlocked('The move breaks the owner policy', checks);
  const ceiling = checks.find((c) => c.rule === 'costCeiling');
  if (move.type === 'NEEDS_OWNER') {
    if (ceiling?.result !== 'needs_approval')
      throw policyBlocked('Only a move over the ceiling needs the owner', checks);
    return;
  }
  if (ceiling?.result !== 'pass')
    throw policyBlocked('Over the cost ceiling without the owner', checks);
  if (move.type === 'ACCEPT' && !sameTerms(move.terms, counter)) {
    throw policyBlocked('An accept must accept the counter as made', checks);
  }
}
