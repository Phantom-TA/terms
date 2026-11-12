import {
  type ActionType,
  discountOn,
  dollars,
  evaluateReminder,
  evaluateSupplierTerms,
  floorToStep,
  fromCents,
  isBlocked,
  normalizeMoneyInput,
  normalizePercentInput,
  type PolicyCheck,
  percentToBps,
  toCents,
  type UpdatePlanItemRequest,
} from '@terms/shared';
import { type WorkbenchRow } from './rows';

/** What the shared policy checks need to know about the owner's current goal and plan. */
export interface EditContext {
  maxDiscountPct: string;
  /** The opening discount, used when an owner switches a row to an offer. */
  openingDiscountPct: string;
  doNotContactIds: readonly string[];
  costCeiling: string;
  /** Total planned cost of the plan as it stands, from the server. */
  plannedCost: string;
  today: string;
}

export type EditField = 'action' | 'discountPct' | 'amountEarly';

export type EditResult =
  | { ok: true; patch: UpdatePlanItemRequest; checks: PolicyCheck[] }
  | { ok: false; message: string; checks: PolicyCheck[] };

const OFFER_ACTIONS: readonly ActionType[] = ['PARTIAL_PAYMENT', 'EARLY_DISCOUNT', 'NEGOTIATE'];

export function isOfferAction(action: ActionType): boolean {
  return OFFER_ACTIONS.includes(action);
}

/** Actions an owner may pick for a row. Only clients with an agent can be negotiated with. */
export function allowedActions(row: Pick<WorkbenchRow, 'hasAgent'>): ActionType[] {
  return row.hasAgent
    ? ['NONE', 'REMINDER', 'PARTIAL_PAYMENT', 'EARLY_DISCOUNT', 'NEGOTIATE']
    : ['NONE', 'REMINDER', 'PARTIAL_PAYMENT', 'EARLY_DISCOUNT'];
}

/** Partial amounts move in $250 steps, as the planner's do. */
const PARTIAL_STEP = dollars(250);

const fail = (message: string, checks: PolicyCheck[] = []): EditResult => ({
  ok: false,
  message,
  checks,
});

/**
 * Pre-checks an owner's edit with the shared policy functions, so an obviously blocked change
 * is stopped before it is sent. The server runs the same checks and is authoritative.
 */
export function checkRowEdit(
  row: WorkbenchRow,
  field: EditField,
  raw: string,
  context: EditContext,
): EditResult {
  const policy = {
    maxDiscountBps: percentToBps(context.maxDiscountPct),
    doNotContact: context.doNotContactIds,
    costCeiling: toCents(context.costCeiling),
  };

  let action: ActionType = row.action;
  let discountPct = row.discountPct;
  let amountEarly = row.amountEarly;
  const patch: UpdatePlanItemRequest = {};

  if (field === 'action') {
    action = raw as ActionType;
    if (action === row.action) return fail('That is already the action.');
    patch.action = action;
    if (isOfferAction(action)) {
      discountPct ??= context.openingDiscountPct;
      amountEarly ??= row.amountDue;
      if (action === 'EARLY_DISCOUNT') {
        amountEarly = row.amountDue;
        patch.amountEarly = amountEarly;
      } else if (action === 'PARTIAL_PAYMENT' && toCents(amountEarly) >= toCents(row.amountDue)) {
        const half = floorToStep(toCents(row.amountDue) / 2n, PARTIAL_STEP);
        if (half <= 0n) return fail('This invoice is too small to ask for part of it.');
        amountEarly = fromCents(half);
        patch.amountEarly = amountEarly;
      }
    }
  } else if (field === 'discountPct') {
    if (!isOfferAction(row.action))
      return fail('Choose an offer action before setting a discount.');
    const percent = normalizePercentInput(raw);
    if (percent === null) return fail('Enter a percentage like 1.2.');
    discountPct = percent;
    patch.discountPct = percent;
  } else {
    if (!isOfferAction(row.action)) return fail('Choose an offer action before setting an amount.');
    const money = normalizeMoneyInput(raw);
    if (money === null) return fail('Enter an amount like 1750.');
    if (row.action === 'EARLY_DISCOUNT' && toCents(money) !== toCents(row.amountDue)) {
      return fail(
        'An early-payment discount covers the whole invoice. Use Partial payment for part of it.',
      );
    }
    if (row.action === 'PARTIAL_PAYMENT' && toCents(money) === toCents(row.amountDue)) {
      return fail('That is the whole invoice. Use Early-payment discount instead.');
    }
    amountEarly = money;
    patch.amountEarly = money;
  }

  if (action === 'NONE') return { ok: true, patch, checks: [] };

  if (action === 'REMINDER') {
    const checks = evaluateReminder(policy, row.clientId);
    return isBlocked(checks) ? fail(blockedMessage(checks), checks) : { ok: true, patch, checks };
  }

  if (discountPct === null || amountEarly === null) {
    return fail('An offer needs a discount and an amount.');
  }
  const early = toCents(amountEarly);
  const bps = percentToBps(discountPct);
  const currentCost = row.item ? toCents(row.item.cost) : 0n;
  const checks = evaluateSupplierTerms(policy, {
    clientId: row.clientId,
    amountDue: toCents(row.amountDue),
    dueDate: row.dueDate,
    amountEarly: early,
    discountBps: bps,
    payBy: row.item?.payBy ?? context.today,
    planCostIfAgreed: toCents(context.plannedCost) - currentCost + discountOn(early, bps),
    round: 1,
    today: context.today,
  });
  return isBlocked(checks) ? fail(blockedMessage(checks), checks) : { ok: true, patch, checks };
}

function blockedMessage(checks: readonly PolicyCheck[]): string {
  return checks.find((c) => c.result === 'blocked')?.detail ?? 'Blocked by your policy.';
}

/** The first check that needs the owner's approval, such as going over the cost ceiling. */
export function approvalNote(checks: readonly PolicyCheck[]): string | null {
  return checks.find((c) => c.result === 'needs_approval')?.detail ?? null;
}
