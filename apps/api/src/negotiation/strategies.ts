/**
 * The default negotiation strategies (CONTEXT.md, "Default negotiation strategies (deterministic
 * bounds)"). Pure functions over money in cents and discounts in bps. They are:
 *  - the deterministic mode used by tests, the simulator baseline and the seeded scenario test;
 *  - the bounds an LLM negotiator's move is checked against (the policy layer still decides).
 *
 * Client agent: accept when the return meets its hurdle and its cash, cap and limit rules pass;
 * otherwise counter at the discount that reaches its target rate (nearest 0.1%), with a smaller
 * partial amount when the early-pay cap or the cash buffer require it; decline after 3 rounds.
 * Supplier agent: accept a counter at or below the row's planned discount, or up to the maximum
 * discount; answer an ask above the maximum with a counter at the maximum; never offer above it.
 * A move that would push the plan over its cost ceiling goes to the owner (NEEDS_OWNER).
 * D-016 (docs/decisions-core.md): a counter within d_max is accepted rather than countered with
 * identical terms.
 */
import {
  type Bps,
  type Cents,
  checkDoNotContact,
  checkNeverPayEarly,
  diffDays,
  discountForAnnualRate,
  discountOn,
  dollars,
  evaluateSupplierTerms,
  floorToStep,
  formatMoney,
  bpsToPercent,
  MAX_NEGOTIATION_ROUNDS,
  meetsAnnualRate,
  minDiscountMeetingRate,
  paymentFor,
  type PolicyCheck,
  checkAutoPayLimit,
  checkCashBuffer,
  checkEarlyPayCap,
  checkHurdleRate,
  checkRoundLimit,
} from '@terms/shared';

/** Partial amounts move in the planner's $250 steps. */
export const PARTIAL_STEP: Cents = dollars(250);

export interface Terms {
  amountEarly: Cents;
  discountBps: Bps;
  payBy: string;
  /** The original due date for the rest of a split deal; null when the whole invoice is paid. */
  remainderDue: string | null;
}

export interface ClientPolicyView {
  hurdleBps: Bps;
  targetBps: Bps;
  cashBuffer: Cents;
  autoPayLimit: Cents;
  earlyPayCap: Cents | null;
  neverPayEarly: readonly string[];
}

/** What the client agent knows when an offer arrives. */
export interface ClientView {
  supplierId: string;
  /** Total still due on the invoice. */
  invoiceDue: Cents;
  dueDate: string;
  policy: ClientPolicyView;
  /** The client's own declared cash (D-013). */
  cashAvailable: Cents;
}

export type ClientMove =
  | {
      type: 'ACCEPT';
      terms: Terms;
      payment: Cents;
      /** Above the auto-pay limit: a person at the client approves before paying. */
      needsHumanApproval: boolean;
      checks: PolicyCheck[];
    }
  | { type: 'COUNTER'; terms: Terms; reason: string; checks: PolicyCheck[] }
  | { type: 'DECLINE'; reason: string; checks: PolicyCheck[] };

/** What the supplier agent knows when a counter arrives. */
export interface SupplierView {
  clientId: string;
  doNotContact: readonly string[];
  maxBps: Bps;
  /** The discount the owner approved for this row in the plan. */
  planBps: Bps;
  ceiling: Cents;
  /** Plan cost of every other row (agreed or still planned). */
  otherRowsCost: Cents;
  invoiceDue: Cents;
  dueDate: string;
  today: string;
}

export type SupplierMove =
  | { type: 'ACCEPT'; terms: Terms; checks: PolicyCheck[] }
  | { type: 'COUNTER'; terms: Terms; reason: string; checks: PolicyCheck[] }
  /** Within every hard limit but over the cost ceiling: the owner decides. */
  | {
      type: 'NEEDS_OWNER';
      terms: Terms;
      /** What the supplier agent does if the owner approves. */
      onApproval: 'ACCEPT' | 'COUNTER';
      overCeilingBy: Cents;
      reason: string;
      checks: PolicyCheck[];
    }
  | { type: 'DECLINE'; reason: string; checks: PolicyCheck[] };

/** Days early for terms against a due date; at least 0. */
export function daysEarlyOf(terms: Pick<Terms, 'payBy'>, dueDate: string): number {
  return Math.max(0, diffDays(dueDate, terms.payBy));
}

/** The client's checks on terms, in a fixed order (the shared policy layer, plus days early). */
export function clientChecks(view: ClientView, terms: Terms, round: number): PolicyCheck[] {
  const days = daysEarlyOf(terms, view.dueDate);
  const payment = paymentFor(terms.amountEarly, terms.discountBps);
  return [
    checkNeverPayEarly(view.supplierId, view.policy.neverPayEarly),
    checkRoundLimit(round),
    days >= 1
      ? checkHurdleRate(terms.discountBps, days, view.policy.hurdleBps)
      : { rule: 'hurdleRate', result: 'blocked', detail: 'Not paid before the due date' },
    checkEarlyPayCap(terms.amountEarly, view.policy.earlyPayCap),
    checkCashBuffer(view.cashAvailable, payment, view.policy.cashBuffer),
    checkAutoPayLimit(payment, view.policy.autoPayLimit),
  ];
}

/** The largest early amount, in partial steps, the client's cap and cash buffer allow. */
function affordableAmount(view: ClientView, wanted: Cents, discountBps: Bps): Cents {
  let amount = wanted;
  if (view.policy.earlyPayCap !== null && amount > view.policy.earlyPayCap) {
    amount = floorToStep(view.policy.earlyPayCap, PARTIAL_STEP);
  }
  const spare = view.cashAvailable - view.policy.cashBuffer;
  while (amount > 0n && paymentFor(amount, discountBps) > spare) {
    // Step down to the next partial step below the current amount.
    const stepped = floorToStep(amount, PARTIAL_STEP);
    amount = stepped === amount ? amount - PARTIAL_STEP : stepped;
  }
  return amount > 0n ? amount : 0n;
}

/** The client agent's move on an offer received in `round` (1-based). */
export function clientMove(view: ClientView, offer: Terms, round: number): ClientMove {
  const checks = clientChecks(view, offer, round);
  const hard = (rule: PolicyCheck['rule']) =>
    checks.find((c) => c.rule === rule)?.result === 'blocked';
  if (hard('neverPayEarly'))
    return { type: 'DECLINE', reason: 'This supplier is never paid early', checks };
  if (hard('roundLimit')) return { type: 'DECLINE', reason: 'Round limit reached', checks };
  const days = daysEarlyOf(offer, view.dueDate);
  if (days < 1) return { type: 'DECLINE', reason: 'The offer asks for no early payment', checks };

  const amount = affordableAmount(view, offer.amountEarly, offer.discountBps);
  if (amount === 0n) {
    return { type: 'DECLINE', reason: 'No early payment fits the cash buffer', checks };
  }
  const meetsHurdle = meetsAnnualRate(offer.discountBps, days, view.policy.hurdleBps);
  if (meetsHurdle && amount === offer.amountEarly) {
    const payment = paymentFor(offer.amountEarly, offer.discountBps);
    return {
      type: 'ACCEPT',
      terms: offer,
      payment,
      needsHumanApproval: payment > view.policy.autoPayLimit,
      checks,
    };
  }
  // Counter: a later round is needed, so the round limit applies to the counter itself.
  if (round >= MAX_NEGOTIATION_ROUNDS) {
    return {
      type: 'DECLINE',
      reason: 'Terms do not meet our policy and the round limit is reached',
      checks,
    };
  }
  let discount = offer.discountBps;
  if (!meetsHurdle) {
    const target = discountForAnnualRate(view.policy.targetBps, days);
    // Rounding to the nearest 0.1% can land under the hurdle when target and hurdle are close.
    const floor = minDiscountMeetingRate(view.policy.hurdleBps, days);
    discount = Math.max(target, floor, offer.discountBps);
  }
  const counterAmount = affordableAmount(view, amount, discount);
  if (counterAmount === 0n) {
    return { type: 'DECLINE', reason: 'No early payment fits the cash buffer', checks };
  }
  const terms: Terms = {
    amountEarly: counterAmount,
    discountBps: discount,
    payBy: offer.payBy,
    remainderDue: counterAmount < view.invoiceDue ? view.dueDate : null,
  };
  const reasons: string[] = [];
  if (!meetsHurdle)
    reasons.push(
      `${bpsToPercent(discount)}% reaches our ${bpsToPercent(view.policy.targetBps)}% target`,
    );
  if (counterAmount < offer.amountEarly)
    reasons.push(`${formatMoney(counterAmount)} is what our cap and buffer allow`);
  return {
    type: 'COUNTER',
    terms,
    reason: reasons.join('; '),
    checks: clientChecks(view, terms, round + 1),
  };
}

/** The supplier's checks on terms it would agree to or send (the shared policy layer). */
export function supplierChecks(view: SupplierView, terms: Terms, round: number): PolicyCheck[] {
  return evaluateSupplierTerms(
    { maxDiscountBps: view.maxBps, doNotContact: view.doNotContact, costCeiling: view.ceiling },
    {
      clientId: view.clientId,
      amountDue: view.invoiceDue,
      dueDate: view.dueDate,
      amountEarly: terms.amountEarly,
      discountBps: terms.discountBps,
      payBy: terms.payBy,
      planCostIfAgreed: view.otherRowsCost + discountOn(terms.amountEarly, terms.discountBps),
      round,
      today: view.today,
    },
  );
}

/** The supplier agent's move on a counter received in `round`. */
export function supplierMove(view: SupplierView, counter: Terms, round: number): SupplierMove {
  const contact = checkDoNotContact(view.clientId, view.doNotContact);
  if (contact.result !== 'pass')
    return { type: 'DECLINE', reason: 'Client is on the do-not-contact list', checks: [contact] };

  const aboveMax = counter.discountBps > view.maxBps;
  const terms: Terms = aboveMax ? { ...counter, discountBps: view.maxBps } : counter;
  // Accepting closes the deal in this round; countering opens the next one.
  const moveRound = aboveMax ? round + 1 : round;
  const checks = supplierChecks(view, terms, moveRound);
  const ceiling = checks.find((c) => c.rule === 'costCeiling');
  const hardBlocks = checks.filter((c) => c.result === 'blocked');
  if (hardBlocks.length > 0) {
    return {
      type: 'DECLINE',
      reason: hardBlocks.map((c) => c.detail).join('; '),
      checks,
    };
  }
  if (ceiling?.result === 'needs_approval') {
    const cost = view.otherRowsCost + discountOn(terms.amountEarly, terms.discountBps);
    return {
      type: 'NEEDS_OWNER',
      terms,
      onApproval: aboveMax ? 'COUNTER' : 'ACCEPT',
      overCeilingBy: cost - view.ceiling,
      reason: `${aboveMax ? 'A counter' : 'Accepting'} at ${bpsToPercent(terms.discountBps)}% costs ${formatMoney(cost - view.ceiling)} over the ${formatMoney(view.ceiling)} ceiling`,
      checks,
    };
  }
  if (aboveMax) {
    return {
      type: 'COUNTER',
      terms,
      reason: `${bpsToPercent(counter.discountBps)}% is above our ${bpsToPercent(view.maxBps)}% maximum`,
      checks,
    };
  }
  return { type: 'ACCEPT', terms, checks };
}
