/**
 * Pure, deterministic policy checks (CONTEXT.md, "Principles and guardrails" rule 2). A model can
 * propose; only these checks and a human can authorise. Every check returns a typed result so the
 * audit trail and the UI badges show exactly which rule passed or blocked.
 *
 * Inputs use domain units: cents (bigint), basis points (integer), ISO dates, whole days.
 */
import { diffDays } from './dates.js';
import { type PolicyResult, type PolicyRule } from './enums.js';
import { type Bps, bpsToPercent, type Cents, discountOn, formatMoney } from './money.js';
import { impliedAnnualRate, meetsAnnualRate } from './rates.js';

export interface PolicyCheck {
  rule: PolicyRule;
  result: PolicyResult;
  /** Plain-language reason, safe to show in the UI and the audit trail. */
  detail: string;
}

export const MAX_NEGOTIATION_ROUNDS = 3;

function check(rule: PolicyRule, result: PolicyResult, detail: string): PolicyCheck {
  return { rule, result, detail };
}

export function isBlocked(checks: readonly PolicyCheck[]): boolean {
  return checks.some((c) => c.result === 'blocked');
}

export function needsApproval(checks: readonly PolicyCheck[]): boolean {
  return !isBlocked(checks) && checks.some((c) => c.result === 'needs_approval');
}

export function allPass(checks: readonly PolicyCheck[]): boolean {
  return checks.every((c) => c.result === 'pass');
}

export function blockedRules(checks: readonly PolicyCheck[]): PolicyRule[] {
  return checks.filter((c) => c.result === 'blocked').map((c) => c.rule);
}

// ---------------------------------------------------------------------------------------------
// Supplier (owner) checks
// ---------------------------------------------------------------------------------------------

/** Hard block: never offer or accept a discount above the owner's maximum. */
export function checkMaxDiscount(discountBps: Bps, maxDiscountBps: Bps): PolicyCheck {
  return discountBps <= maxDiscountBps
    ? check(
        'maxDiscount',
        'pass',
        `${bpsToPercent(discountBps)}% is within the ${bpsToPercent(maxDiscountBps)}% maximum`,
      )
    : check(
        'maxDiscount',
        'blocked',
        `${bpsToPercent(discountBps)}% is above the ${bpsToPercent(maxDiscountBps)}% maximum`,
      );
}

/** Hard block: never message a client on the do-not-contact list. */
export function checkDoNotContact(clientId: string, doNotContact: readonly string[]): PolicyCheck {
  return doNotContact.includes(clientId)
    ? check('doNotContact', 'blocked', 'This client is on the do-not-contact list')
    : check('doNotContact', 'pass', 'Client may be contacted');
}

/** Above the approved ceiling the owner must approve; at or below it the plan proceeds. */
export function checkCostCeiling(totalCost: Cents, ceiling: Cents): PolicyCheck {
  if (totalCost <= ceiling) {
    return check(
      'costCeiling',
      'pass',
      `Plan cost ${formatMoney(totalCost)} is within the ${formatMoney(ceiling)} ceiling`,
    );
  }
  return check(
    'costCeiling',
    'needs_approval',
    `Plan cost ${formatMoney(totalCost)} is ${formatMoney(totalCost - ceiling)} over the ${formatMoney(ceiling)} ceiling`,
  );
}

/** Overdue invoices never get a discount. */
export function checkOverdueNoDiscount(
  discountBps: Bps,
  dueDate: string,
  today: string,
): PolicyCheck {
  const overdue = diffDays(dueDate, today) < 0;
  if (overdue && discountBps > 0) {
    return check('overdueNoDiscount', 'blocked', 'Overdue invoices never get a discount');
  }
  return check(
    'overdueNoDiscount',
    'pass',
    overdue ? 'Overdue invoice, no discount offered' : 'Invoice is not overdue',
  );
}

/** The early amount must be positive and no more than what is still due on the invoice. */
export function checkAmountWithinInvoice(amountEarly: Cents, amountDue: Cents): PolicyCheck {
  if (amountEarly <= 0n) {
    return check('amountWithinInvoice', 'blocked', 'The early amount must be more than zero');
  }
  if (amountEarly > amountDue) {
    return check(
      'amountWithinInvoice',
      'blocked',
      `${formatMoney(amountEarly)} is more than the ${formatMoney(amountDue)} still due`,
    );
  }
  return check(
    'amountWithinInvoice',
    'pass',
    `${formatMoney(amountEarly)} of ${formatMoney(amountDue)} due`,
  );
}

/** A discounted early payment must be paid at least one day before the due date. */
export function checkPayByBeforeDue(payBy: string, dueDate: string): PolicyCheck {
  const daysEarly = diffDays(dueDate, payBy);
  return daysEarly >= 1
    ? check('payByBeforeDue', 'pass', `Paid ${daysEarly} day${daysEarly === 1 ? '' : 's'} early`)
    : check('payByBeforeDue', 'blocked', 'An early payment must be due before the invoice date');
}

/** A negotiation lasts at most three rounds. */
export function checkRoundLimit(round: number, maxRounds = MAX_NEGOTIATION_ROUNDS): PolicyCheck {
  return round >= 1 && round <= maxRounds
    ? check('roundLimit', 'pass', `Round ${round} of ${maxRounds}`)
    : check('roundLimit', 'blocked', `Round ${round} is beyond the ${maxRounds}-round limit`);
}

/** Every offer has an expiry; nothing can be accepted after it. */
export function checkOfferExpiry(expiresAt: Date, now: Date): PolicyCheck {
  return now.getTime() < expiresAt.getTime()
    ? check('offerExpiry', 'pass', `Open until ${expiresAt.toISOString()}`)
    : check('offerExpiry', 'blocked', `Expired at ${expiresAt.toISOString()}`);
}

export interface SupplierPolicyInput {
  maxDiscountBps: Bps;
  doNotContact: readonly string[];
  /** The plan's approved cost ceiling. */
  costCeiling: Cents;
}

export interface SupplierTermsInput {
  clientId: string;
  /** Total still due on the invoice. */
  amountDue: Cents;
  dueDate: string;
  amountEarly: Cents;
  discountBps: Bps;
  payBy: string;
  /** Total plan cost if these terms are agreed (all other committed and planned rows included). */
  planCostIfAgreed: Cents;
  round: number;
  today: string;
}

/**
 * Every supplier-side check on a set of terms, in a fixed order. Used before an offer or counter
 * is sent and before the supplier accepts a client's counter.
 */
export function evaluateSupplierTerms(
  policy: SupplierPolicyInput,
  terms: SupplierTermsInput,
): PolicyCheck[] {
  const checks = [
    checkDoNotContact(terms.clientId, policy.doNotContact),
    checkMaxDiscount(terms.discountBps, policy.maxDiscountBps),
    checkOverdueNoDiscount(terms.discountBps, terms.dueDate, terms.today),
    checkAmountWithinInvoice(terms.amountEarly, terms.amountDue),
    checkRoundLimit(terms.round),
    checkCostCeiling(terms.planCostIfAgreed, policy.costCeiling),
  ];
  if (terms.discountBps > 0) checks.push(checkPayByBeforeDue(terms.payBy, terms.dueDate));
  return checks;
}

/** Checks for sending a reminder: only the do-not-contact rule applies. */
export function evaluateReminder(
  policy: Pick<SupplierPolicyInput, 'doNotContact'>,
  clientId: string,
): PolicyCheck[] {
  return [checkDoNotContact(clientId, policy.doNotContact)];
}

// ---------------------------------------------------------------------------------------------
// Client checks
// ---------------------------------------------------------------------------------------------

/** The offer must return at least the client's hurdle rate a year (exact comparison). */
export function checkHurdleRate(discountBps: Bps, daysEarly: number, hurdleBps: Bps): PolicyCheck {
  const rate = impliedAnnualRate(discountBps, daysEarly);
  return meetsAnnualRate(discountBps, daysEarly, hurdleBps)
    ? check('hurdleRate', 'pass', `${rate}% a year meets the ${bpsToPercent(hurdleBps)}% hurdle`)
    : check(
        'hurdleRate',
        'blocked',
        `${rate}% a year is below the ${bpsToPercent(hurdleBps)}% hurdle`,
      );
}

/** Never pay early if the cash left afterwards would fall below the client's buffer. */
export function checkCashBuffer(cashAvailable: Cents, payment: Cents, buffer: Cents): PolicyCheck {
  const after = cashAvailable - payment;
  return after >= buffer
    ? check(
        'cashBuffer',
        'pass',
        `${formatMoney(after)} left after paying, above the ${formatMoney(buffer)} buffer`,
      )
    : check(
        'cashBuffer',
        'blocked',
        `Only ${formatMoney(after)} would be left, below the ${formatMoney(buffer)} buffer`,
      );
}

/** Above the auto-pay limit a person at the client must approve the payment in PayPal. */
export function checkAutoPayLimit(payment: Cents, autoPayLimit: Cents): PolicyCheck {
  return payment <= autoPayLimit
    ? check(
        'autoPayLimit',
        'pass',
        `${formatMoney(payment)} is within the ${formatMoney(autoPayLimit)} auto-pay limit`,
      )
    : check(
        'autoPayLimit',
        'needs_approval',
        `${formatMoney(payment)} is above the ${formatMoney(autoPayLimit)} auto-pay limit; a person must approve`,
      );
}

/** An early amount above the per-deal cap needs a split (smaller partial amount). */
export function checkEarlyPayCap(amountEarly: Cents, cap: Cents | null): PolicyCheck {
  if (cap === null) return check('earlyPayCap', 'pass', 'No early-payment cap');
  return amountEarly <= cap
    ? check(
        'earlyPayCap',
        'pass',
        `${formatMoney(amountEarly)} is within the ${formatMoney(cap)} early-payment cap`,
      )
    : check(
        'earlyPayCap',
        'blocked',
        `${formatMoney(amountEarly)} is above the ${formatMoney(cap)} early-payment cap`,
      );
}

/** Suppliers on this list are never paid early. */
export function checkNeverPayEarly(
  supplierId: string,
  neverPayEarly: readonly string[],
): PolicyCheck {
  return neverPayEarly.includes(supplierId)
    ? check('neverPayEarly', 'blocked', 'This supplier is never paid early')
    : check('neverPayEarly', 'pass', 'Supplier may be paid early');
}

export interface ClientPolicyInput {
  hurdleBps: Bps;
  cashBuffer: Cents;
  autoPayLimit: Cents;
  earlyPayCap: Cents | null;
  neverPayEarly: readonly string[];
}

export interface ClientOfferInput {
  supplierId: string;
  amountEarly: Cents;
  discountBps: Bps;
  daysEarly: number;
  cashAvailable: Cents;
  round: number;
  expiresAt: Date;
  now: Date;
}

/** What the client pays now for an early amount at a discount. */
export function paymentFor(amountEarly: Cents, discountBps: Bps): Cents {
  return amountEarly - discountOn(amountEarly, discountBps);
}

/** Every client-side check on an incoming offer, in a fixed order. */
export function evaluateClientOffer(
  policy: ClientPolicyInput,
  offer: ClientOfferInput,
): PolicyCheck[] {
  const payment = paymentFor(offer.amountEarly, offer.discountBps);
  return [
    checkNeverPayEarly(offer.supplierId, policy.neverPayEarly),
    checkOfferExpiry(offer.expiresAt, offer.now),
    checkRoundLimit(offer.round),
    checkHurdleRate(offer.discountBps, offer.daysEarly, policy.hurdleBps),
    checkEarlyPayCap(offer.amountEarly, policy.earlyPayCap),
    checkCashBuffer(offer.cashAvailable, payment, policy.cashBuffer),
    checkAutoPayLimit(payment, policy.autoPayLimit),
  ];
}
