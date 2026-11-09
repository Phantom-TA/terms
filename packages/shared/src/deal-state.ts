/**
 * The deal state machine (CONTEXT.md, "Deal states"). The API persists transitions; this module
 * is the single definition of which transitions exist and who may make them.
 *
 * Extensions to the CONTEXT.md table (see docs/decisions-core.md, D-004):
 * - REMOVED: the owner drops a SUGGESTED row before approval.
 * - APPROVED → WITHDRAWN (goal met before sending) and APPROVED → FAILED (delivery failed).
 * - COUNTERED / NEEDS_OWNER → EXPIRED or WITHDRAWN (expiry, or goal met while open).
 * - INVOICE_UPDATED → FAILED (PayPal rejected a later step).
 * - Any open state → PAID / PARTIALLY_PAID when PayPal confirms a payment (e.g. a client pays the
 *   original invoice without taking the offer), and PARTIALLY_PAID → PAID when the remainder lands.
 *   Only the PAYPAL actor may make these transitions.
 */
import { type Actor, DealState } from './enums.js';

const S = DealState.enum;

const PAYMENT_STATES = [S.PAID, S.PARTIALLY_PAID] as const;

export const DEAL_TRANSITIONS: Readonly<Record<DealState, readonly DealState[]>> = {
  SUGGESTED: [S.APPROVED, S.REMOVED, ...PAYMENT_STATES],
  APPROVED: [S.SENT, S.WITHDRAWN, S.FAILED, ...PAYMENT_STATES],
  SENT: [S.COUNTERED, S.AGREED, S.DECLINED, S.EXPIRED, S.WITHDRAWN, ...PAYMENT_STATES],
  COUNTERED: [
    S.SENT,
    S.AGREED,
    S.NEEDS_OWNER,
    S.DECLINED,
    S.EXPIRED,
    S.WITHDRAWN,
    ...PAYMENT_STATES,
  ],
  NEEDS_OWNER: [S.SENT, S.AGREED, S.DECLINED, S.EXPIRED, S.WITHDRAWN, ...PAYMENT_STATES],
  AGREED: [S.INVOICE_UPDATED, S.FAILED, ...PAYMENT_STATES],
  INVOICE_UPDATED: [S.AWAITING_PAYMENT, S.FAILED, ...PAYMENT_STATES],
  AWAITING_PAYMENT: [S.EXPIRED, S.FAILED, ...PAYMENT_STATES],
  PARTIALLY_PAID: [S.PAID],
  PAID: [],
  DECLINED: [],
  EXPIRED: [],
  WITHDRAWN: [],
  FAILED: [],
  REMOVED: [],
};

/** States with no outgoing transitions except PARTIALLY_PAID → PAID. */
export const FINAL_STATES: readonly DealState[] = [
  S.PAID,
  S.PARTIALLY_PAID,
  S.DECLINED,
  S.EXPIRED,
  S.WITHDRAWN,
  S.FAILED,
  S.REMOVED,
];

/** States in which an offer is out and can still be withdrawn when the goal is met. */
export const OPEN_OFFER_STATES: readonly DealState[] = [S.SENT, S.COUNTERED, S.NEEDS_OWNER];

/**
 * States whose cash counts as committed: both sides agreed these exact terms, or PayPal confirmed
 * payment. A deal that later EXPIRES or FAILS stops counting.
 */
export const COMMITTED_STATES: readonly DealState[] = [
  S.AGREED,
  S.INVOICE_UPDATED,
  S.AWAITING_PAYMENT,
  S.PAID,
  S.PARTIALLY_PAID,
];

/** States confirmed by PayPal (a verified webhook or a server-side read). */
export const PAYPAL_CONFIRMED_STATES: readonly DealState[] = PAYMENT_STATES;

export function isFinal(state: DealState): boolean {
  return FINAL_STATES.includes(state);
}

export function isCommitted(state: DealState): boolean {
  return COMMITTED_STATES.includes(state);
}

export function isOpenOffer(state: DealState): boolean {
  return OPEN_OFFER_STATES.includes(state);
}

export function canTransition(from: DealState, to: DealState): boolean {
  return DEAL_TRANSITIONS[from].includes(to);
}

/** Actors allowed to make a transition into a given state; undefined means any actor. */
const RESTRICTED_TARGETS: Partial<Record<DealState, readonly Actor[]>> = {
  // Only PayPal (a verified webhook or a server read) confirms money.
  PAID: ['PAYPAL'],
  PARTIALLY_PAID: ['PAYPAL'],
  // Only the owner approves a plan row or removes it.
  APPROVED: ['OWNER'],
  REMOVED: ['OWNER'],
  // Invoice changes are made by the server's deal engine after a PayPal write succeeds.
  INVOICE_UPDATED: ['SYSTEM'],
  AWAITING_PAYMENT: ['SYSTEM'],
};

export function canActorTransition(from: DealState, to: DealState, actor: Actor): boolean {
  if (!canTransition(from, to)) return false;
  const allowed = RESTRICTED_TARGETS[to];
  return allowed === undefined || allowed.includes(actor);
}

export class IllegalTransitionError extends Error {
  readonly from: DealState;
  readonly to: DealState;
  readonly actor: Actor;
  constructor(from: DealState, to: DealState, actor: Actor) {
    super(
      canTransition(from, to)
        ? `${actor} may not move a deal from ${from} to ${to}`
        : `Illegal deal transition ${from} → ${to}`,
    );
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
    this.actor = actor;
  }
}

/** Throws IllegalTransitionError unless `actor` may move a deal from `from` to `to`. */
export function assertTransition(from: DealState, to: DealState, actor: Actor): void {
  if (!canActorTransition(from, to, actor)) throw new IllegalTransitionError(from, to, actor);
}
