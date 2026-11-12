import {
  type Actor,
  type ActionType,
  formatMoney,
  type ApprovalView,
  type AuditAction,
  type AuditEntry,
  addDays,
  type BusinessRef,
  bpsToPercent,
  type Cents,
  checkAutoPayLimit,
  checkCashBuffer,
  checkCostCeiling,
  checkDoNotContact,
  checkEarlyPayCap,
  checkHurdleRate,
  checkMaxDiscount,
  checkOverdueNoDiscount,
  type CurrentGoalResponse,
  type DealDetail,
  type DealState,
  type DealTransition,
  type DealSummary,
  defaultOpeningBps,
  diffDays,
  discountOn,
  evaluateReminder,
  evaluateSupplierTerms,
  fromCents,
  type Goal,
  impliedAnnualRate,
  type InvoiceRow,
  isCommitted,
  type MessageType,
  type NegotiationMessage,
  type NegotiationTerms,
  normalizeMoneyInput,
  type Plan,
  type PlanItemView,
  type PlanSummary,
  type PolicyCheckView,
  percentToBps,
  type RunwayResponse,
  type ServerEvent,
  type SupplierPolicyView,
  sumCents,
  toCents,
  type UpdatePlanItemRequest,
} from '@terms/shared';

/**
 * The demo scenario from CONTEXT.md as mutable in-memory state, for dev-only mock mode and tests.
 * Money maths uses the shared helpers, so these figures can't drift from the real rules. This is
 * not a model of the real backend: payment state never changes here, because only PayPal does that.
 */

export const TODAY = '2026-11-09';
export const PAYROLL_DATE = '2026-11-13';
export const PAYROLL = 11_400_00n;
export const BALANCE = 5_200_00n;
const STEP_NOW = TODAY;

interface InvoiceSpec {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  slug: string;
  hasAgent: boolean;
  amount: Cents;
  dueInDays: number;
  contactAllowed: boolean;
}

const INVOICES: readonly InvoiceSpec[] = [
  spec('juniper', '1041', 'Juniper Labs', true, 5_000_00n, 18, true),
  spec('harbor', '1043', 'Harbor & Co', true, 7_500_00n, 24, true),
  spec('oak', '1038', 'Oak Street Bakery', false, 1_800_00n, -6, true),
  spec('pinecrest', '1039', 'Pinecrest Dental', false, 2_000_00n, 9, false),
  spec('birch', '1042', 'Birch Legal', false, 1_200_00n, 15, false),
];

function spec(
  key: string,
  number: string,
  clientName: string,
  hasAgent: boolean,
  amount: Cents,
  dueInDays: number,
  contactAllowed: boolean,
): InvoiceSpec {
  return {
    id: `inv_${key}`,
    number,
    clientId: `biz_${key}`,
    clientName,
    slug: clientName
      .toLowerCase()
      .replace(/[^a-z]+/g, '-')
      .replace(/-$/, ''),
    hasAgent,
    amount,
    dueInDays,
    contactAllowed,
  };
}

export const SUPPLIER_POLICY: SupplierPolicyView = {
  maxDiscountPct: '1.20',
  openingDiscountPct: null,
  doNotContact: [],
  bufferPct: '5.00',
  costCeiling: '60.00',
  tone: 'FRIENDLY_BRIEF',
  updatedAt: '2026-11-09T09:00:00Z',
};

function clientRef(s: InvoiceSpec): BusinessRef {
  return { id: s.clientId, name: s.clientName, slug: s.slug, hasAgent: s.hasAgent };
}

function bad(message: string): never {
  throw new Error(message);
}

function specFor(invoiceId: string): InvoiceSpec {
  return INVOICES.find((s) => s.id === invoiceId) ?? bad(`Unknown invoice ${invoiceId}`);
}

/** Every client Maya invoices, as references. */
export function clientRefs(): BusinessRef[] {
  return INVOICES.map(clientRef);
}

export class PolicyBlockedError extends Error {
  constructor(readonly checks: PolicyCheckView[]) {
    super('Blocked by policy.');
  }
}

const isOffer = (item: PlanItemView) => item.action !== 'NONE' && item.action !== 'REMINDER';

/** The API's 400 for an action that doesn't fit the amount. */
export class ShapeError extends Error {}

/**
 * A move that came from one side's policy: as on the server, `reason` in the history is that
 * side's real reason, and the other side reads `publicReason` instead.
 */
export interface PrivateReason {
  side: 'SUPPLIER' | 'CLIENT';
  publicReason: string;
}

/** The server's neutral reasons for a move the other side made. */
const COUNTERED = 'Countered';
const DECLINED = 'Declined';
const WAITING_FOR_SUPPLIER = 'Waiting for the supplier';

export class MockWorld {
  goal: Goal | null = null;
  plan: Plan | null = null;
  readonly deals = new Map<string, DealSummary>();
  readonly messages = new Map<string, NegotiationMessage[]>();
  readonly history = new Map<string, DealTransition[]>();
  /** The steps whose reason only one side reads. */
  readonly privateReasons = new WeakMap<DealTransition, PrivateReason>();
  readonly approvals = new Map<string, ApprovalView>();
  readonly auditLog: AuditEntry[] = [];
  private eventSeq = 0;
  private nowSeq = 0;

  private stamp(): string {
    this.nowSeq += 1;
    const minutes = String(Math.floor(this.nowSeq / 60) % 60).padStart(2, '0');
    const seconds = String(this.nowSeq % 60).padStart(2, '0');
    return `2026-11-09T10:${minutes}:${seconds}Z`;
  }

  currentGoal(): CurrentGoalResponse {
    return { goal: this.goal, plan: this.plan };
  }

  /** A tiny stand-in for the AI goal parser: enough for the demo sentence. */
  parseGoal(text: string): Goal {
    const amountMatch = /\$\s?([\d,]+(?:\.\d{1,2})?)/.exec(text);
    const amount = normalizeMoneyInput(amountMatch?.[1] ?? '') ?? '6200.00';
    const maxMatch = /(\d+(?:\.\d+)?)\s*%/.exec(text);
    const maxPct = maxMatch ? bpsToPercent(Math.round(Number(maxMatch[1]) * 100)) : '1.20';
    const named = INVOICES.filter((s) =>
      new RegExp(`\\b${s.clientName.split(' ')[0] ?? ''}\\b`, 'i').test(
        /(?:don'?t contact|do not contact)(.*)/i.exec(text)?.[1] ?? '',
      ),
    );
    const defaulted: Goal['defaultedFields'] = [];
    if (!maxMatch) defaulted.push('maxDiscountPct');
    defaulted.push('bufferPct');
    const goal: Goal = {
      id: 'goal_1',
      rawText: text,
      amount,
      deadline: PAYROLL_DATE,
      maxDiscountPct: maxPct,
      openingDiscountPct: bpsToPercent(defaultOpeningBps(percentToBps(maxPct))),
      doNotContact: named.map((s) => ({
        name: s.clientName.split(' ')[0] ?? s.clientName,
        businessId: s.clientId,
        matchedName: s.clientName,
      })),
      bufferPct: '5.00',
      target: this.targetFor(amount, '5.00'),
      status: 'DRAFT',
      forecast: this.forecastFor(amount),
      defaultedFields: defaulted,
      createdAt: this.stamp(),
      updatedAt: this.stamp(),
    };
    this.goal = goal;
    this.plan = null;
    this.deals.clear();
    this.log('GOAL_PARSED', `Goal read from: “${text}”`, 'SYSTEM', 'GOAL', goal.id);
    return goal;
  }

  /** The forecaster's check of the stated gap against PayPal history. Re-run when the amount changes. */
  private forecastFor(amount: string): Goal['forecast'] {
    const confirmed = PAYROLL - BALANCE === toCents(amount);
    return {
      balance: fromCents(BALANCE),
      balanceSource: 'PAYPAL_BALANCES',
      balanceAsOf: '2026-11-09T09:55:00Z',
      flows: [
        {
          date: PAYROLL_DATE,
          amount: fromCents(-PAYROLL),
          kind: 'PAYROLL',
          label: 'Payroll (biweekly)',
          source: 'PAYPAL_TXN',
        },
      ],
      projectedBalance: fromCents(BALANCE - PAYROLL),
      impliedGap: fromCents(PAYROLL - BALANCE),
      verdict: confirmed ? 'CONFIRMED' : 'QUESTIONED',
      message: confirmed
        ? 'Payroll of $11,400 lands Friday; your balance is $5,200; the gap is $6,200 — confirmed'
        : `Your PayPal history implies a gap of $${(Number(PAYROLL - BALANCE) / 100).toLocaleString('en-US')}, not the amount you stated.`,
    };
  }

  private targetFor(amount: string, bufferPct: string): string {
    const gap = toCents(amount);
    return fromCents(gap + discountOn(gap, percentToBps(bufferPct)));
  }

  updateGoal(patch: {
    amount?: string | undefined;
    deadline?: string | undefined;
    maxDiscountPct?: string | undefined;
    openingDiscountPct?: string | undefined;
    bufferPct?: string | undefined;
    doNotContactIds?: string[] | undefined;
  }): Goal {
    const goal = this.goal ?? bad('No goal');
    const next: Goal = { ...goal, updatedAt: this.stamp() };
    if (patch.amount !== undefined) {
      next.amount = patch.amount;
      next.forecast = this.forecastFor(patch.amount);
    }
    if (patch.deadline !== undefined) next.deadline = patch.deadline;
    if (patch.maxDiscountPct !== undefined) {
      next.maxDiscountPct = patch.maxDiscountPct;
      next.openingDiscountPct = bpsToPercent(defaultOpeningBps(percentToBps(patch.maxDiscountPct)));
    }
    if (patch.openingDiscountPct !== undefined) next.openingDiscountPct = patch.openingDiscountPct;
    if (patch.bufferPct !== undefined) next.bufferPct = patch.bufferPct;
    if (patch.doNotContactIds !== undefined) {
      next.doNotContact = patch.doNotContactIds.map((id) => {
        const s = INVOICES.find((i) => i.clientId === id) ?? bad(`Unknown client ${id}`);
        return { name: s.clientName, businessId: id, matchedName: s.clientName };
      });
    }
    next.target = this.targetFor(next.amount, next.bufferPct);
    this.goal = next;
    return next;
  }

  /** The planner's job, reproduced for the demo numbers. The real one is deterministic code on the API. */
  createPlan(): Plan {
    const goal = this.goal ?? bad('No goal');
    const blocked = new Set(goal.doNotContact.map((d) => d.businessId));
    const openBps = percentToBps(goal.openingDiscountPct);
    const items: PlanItemView[] = INVOICES.map((s) => {
      const base = this.blankItem(s);
      if (blocked.has(s.clientId) || !s.contactAllowed) {
        return {
          ...base,
          reasonCode: 'DO_NOT_CONTACT',
          reason: 'On the do-not-contact list; never messaged.',
        };
      }
      if (s.dueInDays < 0) {
        return {
          ...base,
          action: 'REMINDER',
          reasonCode: 'REMINDER_OVERDUE',
          reason: 'Overdue, so a free reminder first. Overdue invoices never get a discount.',
        };
      }
      if (s.id === 'inv_juniper') {
        return this.offerItem(
          base,
          s,
          'NEGOTIATE',
          s.amount,
          openBps,
          'CHEAPEST_COVER',
          'Cheapest way to commit a whole invoice toward the goal.',
        );
      }
      if (s.id === 'inv_harbor') {
        return this.offerItem(
          base,
          s,
          'NEGOTIATE',
          1_750_00n,
          openBps,
          'PARTIAL_TO_FIT_GAP',
          'Only $1,750 is needed to cover the gap, so only that much is asked early.',
        );
      }
      return { ...base, reasonCode: 'NOT_NEEDED', reason: 'Not needed for the goal.' };
    });
    // The next-cheapest offer, used automatically if one is declined and the ceiling allows.
    const harbor = INVOICES.find((i) => i.id === 'inv_harbor');
    if (harbor && !blocked.has(harbor.clientId)) {
      items.push({
        ...this.offerItem(
          this.blankItem(harbor),
          harbor,
          'NEGOTIATE',
          2_500_00n,
          openBps,
          'BACKUP',
          'Next-cheapest way to commit the cash if an offer is declined.',
        ),
        id: 'item_inv_harbor_backup_1',
        rank: 'BACKUP',
        backupOrder: 1,
      });
    }
    const plannedCost = sumCents(
      items.filter((i) => i.rank === 'PRIMARY').map((i) => toCents(i.cost)),
    );
    const checkedItems = items.map((item) => ({
      ...item,
      policyChecks: this.checksFor(item, goal, plannedCost, SUPPLIER_POLICY.costCeiling),
    }));
    const plan: Plan = {
      id: 'plan_1',
      goalId: goal.id,
      status: 'DRAFT',
      costCeiling: SUPPLIER_POLICY.costCeiling,
      approvedAt: null,
      createdAt: this.stamp(),
      summary: this.summaryFor(goal, checkedItems, SUPPLIER_POLICY.costCeiling),
      items: checkedItems,
    };
    this.plan = plan;
    this.goal = { ...goal, status: 'PLANNED', updatedAt: this.stamp() };
    this.deals.clear();
    this.log(
      'PLAN_CREATED',
      `Plan commits ${formatMoney(plan.summary.plannedCommitted)} for ${formatMoney(plan.summary.plannedCost)}.`,
      'SYSTEM',
      'PLAN',
      plan.id,
    );
    return plan;
  }

  private blankItem(s: InvoiceSpec): PlanItemView {
    return {
      id: `item_${s.id}`,
      planId: 'plan_1',
      invoiceId: s.id,
      invoiceNumber: s.number,
      client: clientRef(s),
      action: 'NONE',
      rank: 'PRIMARY',
      backupOrder: null,
      discountPct: null,
      amountEarly: null,
      payBy: null,
      daysEarly: null,
      impliedAnnualRate: null,
      cost: '0.00',
      committedIfAgreed: '0.00',
      countsTowardGoal: false,
      reasonCode: 'NOT_NEEDED',
      reason: '',
      explanation: null,
      editedByOwner: false,
      policyChecks: [],
      dealId: null,
      dealState: null,
    };
  }

  private offerItem(
    base: PlanItemView,
    s: InvoiceSpec,
    action: ActionType,
    early: Cents,
    bps: number,
    reasonCode: PlanItemView['reasonCode'],
    reason: string,
  ): PlanItemView {
    const daysEarly = diffDays(addDays(TODAY, s.dueInDays), STEP_NOW);
    const cost = discountOn(early, bps);
    return {
      ...base,
      action,
      discountPct: bpsToPercent(bps),
      amountEarly: fromCents(early),
      payBy: STEP_NOW,
      daysEarly,
      impliedAnnualRate: impliedAnnualRate(bps, daysEarly),
      cost: fromCents(cost),
      committedIfAgreed: fromCents(early - cost),
      countsTowardGoal: true,
      reasonCode,
      reason,
      explanation: `At ${bpsToPercent(bps)}%, ${s.clientName} earns ${impliedAnnualRate(bps, daysEarly)}% a year for paying ${daysEarly} days early.`,
    };
  }

  private withDeal(item: PlanItemView): PlanItemView {
    const deal = this.deals.get(item.id);
    return deal ? { ...item, dealId: deal.id, dealState: deal.state } : item;
  }

  private syncDeal(item: PlanItemView): void {
    if (item.action === 'NONE') {
      this.deals.delete(item.id);
      return;
    }
    const s = specFor(item.invoiceId);
    const existing = this.deals.get(item.id);
    const terms =
      item.amountEarly && item.discountPct && item.payBy
        ? {
            amountEarly: item.amountEarly,
            discountPct: item.discountPct,
            payBy: item.payBy,
            remainderDue: toCents(item.amountEarly) < s.amount ? addDays(TODAY, s.dueInDays) : null,
          }
        : null;
    this.deals.set(item.id, {
      id: existing?.id ?? `deal_${s.id.slice(4)}`,
      planId: 'plan_1',
      planItemId: item.id,
      invoiceId: s.id,
      invoiceNumber: s.number,
      client: clientRef(s),
      action: item.action,
      state: existing?.state ?? 'SUGGESTED',
      currentTerms: terms,
      agreedTerms: null,
      impliedAnnualRate: item.impliedAnnualRate,
      cost: item.cost,
      committedIfAgreed: item.committedIfAgreed,
      countsAsCommitted: false,
      round: 0,
      pendingApprovalId: null,
      closedReason: null,
      updatedAt: this.stamp(),
    });
  }

  summaryFor(goal: Goal, items: readonly PlanItemView[], ceiling: string): PlanSummary {
    const primary = items.filter((i) => i.rank === 'PRIMARY');
    const plannedCommitted = sumCents(primary.map((i) => toCents(i.committedIfAgreed)));
    const plannedCost = sumCents(primary.map((i) => toCents(i.cost)));
    const target = toCents(goal.target);
    const deals = [...this.deals.values()].filter((d) => d.countsAsCommitted);
    const committed = sumCents(deals.map((d) => toCents(d.committedIfAgreed)));
    const bestEffort = sumCents(
      primary.filter((i) => i.action === 'REMINDER').map((i) => specFor(i.invoiceId).amount),
    );
    return {
      gap: goal.amount,
      buffer: fromCents(target - toCents(goal.amount)),
      target: goal.target,
      plannedCommitted: fromCents(plannedCommitted),
      plannedCost: fromCents(plannedCost),
      committed: fromCents(committed),
      paid: '0.00',
      costSoFar: fromCents(sumCents(deals.map((d) => toCents(d.cost)))),
      bestEffort: fromCents(bestEffort),
      costCeiling: ceiling,
      remaining: fromCents(committed >= target ? 0n : target - committed),
      goalMet: committed >= target,
      shortfall: plannedCommitted < target,
    };
  }

  /** The checks the server runs on a row. Protected rows carry their blocked do-not-contact check. */
  private checksFor(
    item: PlanItemView,
    goal: Goal,
    planCost: Cents,
    ceiling: string,
  ): PolicyCheckView[] {
    const s = specFor(item.invoiceId);
    const policy = {
      maxDiscountBps: percentToBps(goal.maxDiscountPct),
      doNotContact: [
        ...goal.doNotContact.flatMap((d) => (d.businessId ? [d.businessId] : [])),
        ...INVOICES.filter((i) => !i.contactAllowed).map((i) => i.clientId),
      ],
      costCeiling: toCents(ceiling),
    };
    if (item.action === 'NONE') {
      return policy.doNotContact.includes(s.clientId) ? evaluateReminder(policy, s.clientId) : [];
    }
    if (item.action === 'REMINDER') return evaluateReminder(policy, s.clientId);
    return evaluateSupplierTerms(policy, {
      clientId: s.clientId,
      amountDue: s.amount,
      dueDate: addDays(TODAY, s.dueInDays),
      amountEarly: toCents(item.amountEarly ?? '0.00'),
      discountBps: percentToBps(item.discountPct ?? '0.00'),
      payBy: item.payBy ?? TODAY,
      planCostIfAgreed: planCost,
      round: 1,
      today: TODAY,
    });
  }

  /** Applies an owner edit after the same policy checks the server runs. Throws PolicyBlockedError. */
  updateItem(
    itemId: string,
    patch: UpdatePlanItemRequest,
  ): { plan: Plan; policyChecks: PolicyCheckView[] } {
    const plan = this.plan ?? bad('No plan');
    if (plan.status !== 'DRAFT') bad('Only a draft plan can be edited.');
    const current = plan.items.find((i) => i.id === itemId) ?? bad(`Unknown item ${itemId}`);
    const s = specFor(current.invoiceId);
    const goal = this.goal ?? bad('No goal');

    let next: PlanItemView = { ...current, editedByOwner: true };
    const action = patch.excluded === true ? 'NONE' : (patch.action ?? current.action);
    if (action === 'NONE' || action === 'REMINDER') {
      next = {
        ...this.blankItem(s),
        action,
        editedByOwner: true,
        reasonCode: patch.excluded === true ? 'OWNER_EXCLUDED' : 'OWNER_EDIT',
        reason:
          patch.excluded === true ? 'You excluded this client from the plan.' : 'Changed by you.',
      };
    } else {
      const bps = percentToBps(
        patch.discountPct ??
          current.discountPct ??
          bpsToPercent(percentToBps(goal.openingDiscountPct)),
      );
      const early = toCents(patch.amountEarly ?? current.amountEarly ?? fromCents(s.amount));
      // An invoice that is overdue or due today can't be paid "early"; the policy layer says so
      // before any rate is computed.
      if (s.dueInDays < 1) {
        throw new PolicyBlockedError([
          checkOverdueNoDiscount(bps, addDays(TODAY, s.dueInDays), TODAY),
        ]);
      }
      if (action === 'EARLY_DISCOUNT' && early !== s.amount) {
        throw new ShapeError('Use PARTIAL_PAYMENT for part of the invoice');
      }
      if (action === 'PARTIAL_PAYMENT' && early >= s.amount) {
        throw new ShapeError('Use EARLY_DISCOUNT for the whole amount');
      }
      next = this.offerItem(
        { ...current, action },
        s,
        action,
        early,
        bps,
        'OWNER_EDIT',
        'Changed by you.',
      );
      next.editedByOwner = true;
    }

    const others = plan.items.filter((i) => i.id !== itemId && i.rank === 'PRIMARY');
    const planCostIfAgreed = sumCents([...others, next].map((i) => toCents(i.cost)));
    const checks = this.checksFor(next, goal, planCostIfAgreed, plan.costCeiling);
    // Going over the ceiling needs the owner's approval, and choosing no action is never blocked.
    if (next.action !== 'NONE' && checks.some((c) => c.result === 'blocked')) {
      throw new PolicyBlockedError(checks);
    }
    next.policyChecks = checks;
    this.log(
      'PLAN_ITEM_EDITED',
      `You changed the row for ${s.clientName}.`,
      'OWNER',
      'PLAN_ITEM',
      itemId,
    );

    const items = plan.items.map((i) => (i.id === itemId ? next : i));
    this.plan = { ...plan, items, summary: this.summaryFor(goal, items, plan.costCeiling) };
    return { plan: this.plan, policyChecks: checks };
  }

  approve(costCeiling: string): Plan {
    const plan = this.plan ?? bad('No plan');
    const goal = this.goal ?? bad('No goal');
    for (const item of plan.items) {
      if (item.rank === 'PRIMARY' && item.action !== 'NONE') this.syncDeal(item);
    }
    for (const [key, deal] of this.deals) {
      this.deals.set(key, { ...deal, state: 'APPROVED', updatedAt: this.stamp() });
    }
    const items = plan.items.map((i) => this.withDeal(i));
    this.plan = {
      ...plan,
      status: 'APPROVED',
      approvedAt: this.stamp(),
      costCeiling,
      items,
      summary: this.summaryFor(goal, items, costCeiling),
    };
    this.goal = { ...goal, status: 'ACTIVE' };
    this.log(
      'PLAN_APPROVED',
      `You approved the plan with a ${formatMoney(costCeiling)} ceiling.`,
      'OWNER',
      'PLAN',
      this.plan.id,
    );
    return this.plan;
  }

  // ---------------------------------------------------------------------------------------------
  // The negotiation from CONTEXT.md. A script, not a model of the agents. It stops at the owner's
  // approval and at the client's payment, because only PayPal can say that money moved.
  // ---------------------------------------------------------------------------------------------

  private event(type: ServerEvent['type'], data: unknown): ServerEvent {
    this.eventSeq += 1;
    return { id: `mock-event-${this.eventSeq}`, type, at: this.stamp(), data } as ServerEvent;
  }

  private itemFor(invoiceId: string): PlanItemView {
    const item = this.plan?.items.find((i) => i.invoiceId === invoiceId && i.rank === 'PRIMARY');
    return item ?? bad(`No plan row for ${invoiceId}`);
  }

  private termsFor(s: InvoiceSpec, early: Cents, bps: number): NegotiationTerms {
    return {
      amountEarly: fromCents(early),
      discountPct: bpsToPercent(bps),
      payBy: TODAY,
      remainderDue: early < s.amount ? addDays(TODAY, s.dueInDays) : null,
    };
  }

  private moveDeal(
    itemId: string,
    state: DealState,
    actor: Actor,
    reason: string,
    patch: Partial<DealSummary> = {},
    privateTo: PrivateReason | null = null,
  ): ServerEvent {
    const deal = this.deals.get(itemId) ?? bad(`No deal for ${itemId}`);
    const steps = this.history.get(deal.id) ?? [];
    const step: DealTransition = { from: deal.state, to: state, actor, reason, at: this.stamp() };
    steps.push(step);
    this.history.set(deal.id, steps);
    if (privateTo) this.privateReasons.set(step, privateTo);
    const next: DealSummary = {
      ...deal,
      ...patch,
      state,
      countsAsCommitted: isCommitted(state),
      updatedAt: this.stamp(),
    };
    this.deals.set(itemId, next);
    const entry = this.log(
      'DEAL_TRANSITION',
      `${deal.client.name}: ${deal.state.toLowerCase()} → ${state.toLowerCase()}.`,
      actor,
      'DEAL',
      deal.id,
      deal.id,
    );
    entry.details = privateTo
      ? { reason, privateTo: privateTo.side, publicReason: privateTo.publicReason }
      : { reason };
    return this.event('deal.updated', { deal: next });
  }

  private say(
    deal: DealSummary,
    s: InvoiceSpec,
    side: 'supplier' | 'client',
    type: MessageType,
    terms: NegotiationTerms | null,
    note: string,
    policyChecks: PolicyCheckView[],
    round: number,
  ): ServerEvent {
    const list = this.messages.get(deal.id) ?? [];
    const bps = terms ? percentToBps(terms.discountPct) : 0;
    const early = terms ? toCents(terms.amountEarly) : 0n;
    const message: NegotiationMessage = {
      id: `msg_${deal.id}_${list.length + 1}`,
      dealId: deal.id,
      invoiceId: `INV2-${s.number}-SBOX-0000-0000`,
      from: side === 'supplier' ? 'supplier:maya-studio' : `client:${s.slug}`,
      to: side === 'supplier' ? `client:${s.slug}` : 'supplier:maya-studio',
      actor: side === 'supplier' ? 'SUPPLIER_AGENT' : 'CLIENT_AGENT',
      type,
      terms,
      impliedAnnualRate: terms ? impliedAnnualRate(bps, s.dueInDays) : null,
      payNow: terms ? fromCents(early - discountOn(early, bps)) : null,
      note,
      policyChecks,
      expiresAt: type === 'OFFER' || type === 'COUNTER' ? '2026-11-12T18:00:00Z' : null,
      round,
      createdAt: this.stamp(),
    };
    list.push(message);
    this.messages.set(deal.id, list);
    this.log(
      'NEGOTIATION_MESSAGE',
      `${side === 'supplier' ? 'Maya Studio' : s.clientName}’s agent: ${type.toLowerCase()}.`,
      message.actor,
      'DEAL',
      deal.id,
      deal.id,
    );
    return this.event('negotiation.message', { message });
  }

  /** Writes an audit entry for a step that isn't a PayPal call. */
  log(
    action: AuditAction,
    summary: string,
    actor: Actor,
    subjectType: AuditEntry['subjectType'],
    subjectId: string,
    dealId: string | null = null,
  ): AuditEntry {
    const entry: AuditEntry = {
      id: `audit_${this.auditLog.length + 1}`,
      at: this.stamp(),
      actor,
      action,
      subjectType,
      subjectId,
      summary,
      details: {},
      paypalDebugId: null,
      paypalRequestId: null,
      webhookVerified: null,
      paypalCall: null,
      dealId,
    };
    this.auditLog.push(entry);
    return entry;
  }

  private record(
    dealId: string,
    action: AuditAction,
    summary: string,
    actor: Actor,
    paypalCall: string | null,
    webhookVerified: boolean | null = null,
  ): ServerEvent {
    const entry: AuditEntry = {
      id: `audit_${this.auditLog.length + 1}`,
      at: this.stamp(),
      actor,
      action,
      subjectType: 'DEAL',
      subjectId: dealId,
      summary,
      details: {},
      paypalDebugId: paypalCall ? `debug-${this.auditLog.length + 1}` : null,
      paypalRequestId: paypalCall ? `req-${this.auditLog.length + 1}` : null,
      webhookVerified,
      paypalCall,
      dealId,
    };
    this.auditLog.push(entry);
    return this.event('audit.appended', { entry });
  }

  private refreshed(): ServerEvent[] {
    const plan = this.plan ?? bad('No plan');
    const goal = this.goal ?? bad('No goal');
    const summary = this.summaryFor(goal, plan.items, plan.costCeiling);
    const status = summary.goalMet ? 'MET' : plan.status;
    this.plan = { ...plan, status, summary, items: plan.items.map((i) => this.withDeal(i)) };
    const events = [
      this.event('plan.updated', { planId: plan.id, status, summary }),
      this.event('runway.updated', { runway: this.runway() }),
      ...this.invoiceRows()
        .filter((row) => row.deal)
        .map((invoice) => this.event('invoice.updated', { invoice })),
    ];
    if (summary.goalMet) {
      events.push(
        this.event('goal.met', {
          goalId: goal.id,
          planId: plan.id,
          target: summary.target,
          committed: summary.committed,
          cost: summary.costSoFar,
          withdrawnDealIds: [],
        }),
      );
    }
    return events;
  }

  /**
   * Runs the demo up to the owner's decision and returns the events the server would have sent.
   * It follows the demo goal's 1.2% maximum. A row the owner removed from the plan is left out.
   */
  startNegotiation(): ServerEvent[] {
    const goal = this.goal ?? bad('No goal');
    const maxBps = percentToBps(goal.maxDiscountPct);
    const juniperSpec = specFor('inv_juniper');
    const harborSpec = specFor('inv_harbor');
    const juniperItem = this.itemFor('inv_juniper');
    const harborItem = this.itemFor('inv_harbor');
    const juniperBps = percentToBps(juniperItem.discountPct ?? '0.80');
    const harborBps = percentToBps(harborItem.discountPct ?? '0.80');
    const juniperEarly = toCents(juniperItem.amountEarly ?? '5000.00');
    const harborEarly = toCents(harborItem.amountEarly ?? '1750.00');
    const juniperTerms = this.termsFor(juniperSpec, juniperEarly, juniperBps);
    const harborTerms = this.termsFor(harborSpec, harborEarly, harborBps);
    const events: ServerEvent[] = [];

    const oak = this.deals.get('item_inv_oak');
    if (oak) {
      events.push(
        this.moveDeal('item_inv_oak', 'SENT', 'SYSTEM', 'Reminder sent.'),
        this.record(
          oak.id,
          'REMINDER_SENT',
          'Reminder sent through PayPal.',
          'SYSTEM',
          'POST /v2/invoicing/invoices/{id}/remind',
        ),
      );
    }

    if (isOffer(juniperItem)) {
      // Juniper accepts the opening offer.
      const juniper = this.deals.get('item_inv_juniper') ?? bad('No Juniper deal');
      const juniperPayment = juniperEarly - discountOn(juniperEarly, juniperBps);
      events.push(
        this.moveDeal('item_inv_juniper', 'SENT', 'SUPPLIER_AGENT', 'Offer sent.', { round: 1 }),
        this.say(
          juniper,
          juniperSpec,
          'supplier',
          'OFFER',
          juniperTerms,
          `Happy to take ${formatMoney(fromCents(juniperPayment))} today against ${formatMoney(fromCents(juniperEarly))} of invoice 1041.`,
          [checkMaxDiscount(juniperBps, maxBps), checkDoNotContact(juniperSpec.clientId, [])],
          1,
        ),
        this.say(
          juniper,
          juniperSpec,
          'client',
          'ACCEPT',
          juniperTerms,
          'That works for us, so we accept.',
          [
            checkHurdleRate(juniperBps, juniperSpec.dueInDays, 1200),
            checkCashBuffer(50_000_00n, juniperPayment, 20_000_00n),
            checkAutoPayLimit(juniperPayment, 3_000_00n),
          ],
          1,
        ),
        this.moveDeal(
          'item_inv_juniper',
          'AGREED',
          'CLIENT_AGENT',
          'Both sides accepted these terms.',
          { agreedTerms: juniperTerms },
        ),
        this.record(
          juniper.id,
          'INVOICE_UPDATED',
          'PayPal invoice updated with a $40.00 discount.',
          'SYSTEM',
          'PUT /v2/invoicing/invoices/{id}',
        ),
        this.moveDeal('item_inv_juniper', 'INVOICE_UPDATED', 'SYSTEM', 'PayPal invoice updated.'),
        this.moveDeal(
          'item_inv_juniper',
          'AWAITING_PAYMENT',
          'SYSTEM',
          'Waiting for the client to pay.',
          { pendingApprovalId: 'appr_juniper_payment' },
        ),
      );
      this.approvals.set('appr_juniper_payment', {
        id: 'appr_juniper_payment',
        type: 'CLIENT_PAYMENT',
        requestedFrom: 'CLIENT_HUMAN',
        decision: 'PENDING',
        title: 'Approve the $4,960.00 payment to Maya Studio',
        summary:
          'This payment is above the auto-pay limit, so a person at Juniper Labs approves it in PayPal.',
        planId: 'plan_1',
        dealId: juniper.id,
        terms: juniperTerms,
        paymentAmount: fromCents(juniperPayment),
        costImpact: null,
        createdAt: this.stamp(),
        decidedAt: null,
        expiresAt: null,
        decisionNote: null,
      });
    }

    if (isOffer(harborItem)) {
      // Harbor counters above the owner's maximum, so it comes back to her.
      const harbor = this.deals.get('item_inv_harbor') ?? bad('No Harbor deal');
      const counterTerms = this.termsFor(harborSpec, harborEarly, 150);
      const proposedTerms = this.termsFor(harborSpec, harborEarly, maxBps);
      const plan = this.plan ?? bad('No plan');
      const costAfter =
        toCents(plan.summary.plannedCost) -
        toCents(harborItem.cost) +
        discountOn(harborEarly, maxBps);
      const ceiling = toCents(plan.costCeiling);
      const approval: ApprovalView = {
        id: 'appr_harbor_counter',
        type: 'COUNTER_OVER_PLAN',
        requestedFrom: 'OWNER',
        decision: 'PENDING',
        title: `Counter to Harbor & Co at ${bpsToPercent(maxBps)}%`,
        summary:
          'Harbor asked for 1.50%, above your maximum. Your agent would counter at your maximum instead, which takes the plan over your ceiling.',
        planId: plan.id,
        dealId: harbor.id,
        terms: proposedTerms,
        paymentAmount: null,
        costImpact: {
          planCostBefore: plan.summary.plannedCost,
          planCostAfter: fromCents(costAfter),
          delta: fromCents(costAfter - toCents(plan.summary.plannedCost)),
          ceiling: plan.costCeiling,
          overCeilingBy: fromCents(costAfter > ceiling ? costAfter - ceiling : 0n),
        },
        createdAt: this.stamp(),
        decidedAt: null,
        expiresAt: '2026-11-12T18:00:00Z',
        decisionNote: null,
      };
      this.approvals.set(approval.id, approval);
      events.push(
        this.moveDeal('item_inv_harbor', 'SENT', 'SUPPLIER_AGENT', 'Offer sent.', { round: 1 }),
        this.say(
          harbor,
          harborSpec,
          'supplier',
          'OFFER',
          harborTerms,
          'Could you pay $1,750 of invoice 1043 early at 0.8%?',
          [checkMaxDiscount(harborBps, maxBps), checkDoNotContact(harborSpec.clientId, [])],
          1,
        ),
        this.say(
          harbor,
          harborSpec,
          'client',
          'COUNTER',
          counterTerms,
          'We could pay early at 1.5%.',
          // A message carries only its sender's checks; the owner's are in the approval.
          [checkHurdleRate(harborBps, harborSpec.dueInDays, 1500)],
          1,
        ),
        this.moveDeal(
          'item_inv_harbor',
          'COUNTERED',
          'CLIENT_AGENT',
          '0.80% is under our 15% hurdle, so we asked for 1.50%.',
          {
            currentTerms: counterTerms,
            impliedAnnualRate: impliedAnnualRate(150, harborSpec.dueInDays),
            cost: fromCents(discountOn(harborEarly, 150)),
            committedIfAgreed: fromCents(harborEarly - discountOn(harborEarly, 150)),
          },
          { side: 'CLIENT', publicReason: COUNTERED },
        ),
        this.moveDeal(
          'item_inv_harbor',
          'NEEDS_OWNER',
          'SUPPLIER_AGENT',
          'The counter that fits your maximum goes over your ceiling.',
          { pendingApprovalId: approval.id, round: 1 },
          { side: 'SUPPLIER', publicReason: WAITING_FOR_SUPPLIER },
        ),
        this.event('approval.requested', { approval }),
      );
    }

    events.push(...this.refreshed());
    return events;
  }

  /** The owner's decision on a counter. Returns the approval and what the server would send. */
  decideApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string | null,
  ): { approval: ApprovalView; events: ServerEvent[] } {
    const current = this.approvals.get(approvalId) ?? bad(`Unknown approval ${approvalId}`);
    if (current.decision !== 'PENDING') bad('This approval has already been decided.');
    const approval: ApprovalView = {
      ...current,
      decision,
      decidedAt: this.stamp(),
      decisionNote: note,
    };
    this.approvals.set(approvalId, approval);
    const events: ServerEvent[] = [this.event('approval.decided', { approval })];
    if (approval.type === 'CLIENT_PAYMENT') {
      this.log(
        'APPROVAL_DECIDED',
        `A person at the client ${decision === 'APPROVED' ? 'approved' : 'rejected'} the payment.`,
        'CLIENT_HUMAN',
        'APPROVAL',
        approval.id,
        approval.dealId,
      );
      return { approval, events };
    }
    this.log(
      'APPROVAL_DECIDED',
      `You ${decision === 'APPROVED' ? 'approved' : 'rejected'}: ${approval.title}.`,
      'OWNER',
      'APPROVAL',
      approval.id,
      approval.dealId,
    );
    const deal = [...this.deals.values()].find((d) => d.id === approval.dealId) ?? bad('No deal');
    const s = specFor(deal.invoiceId);

    if (decision === 'REJECTED') {
      events.push(
        this.say(
          deal,
          s,
          'supplier',
          'WITHDRAW',
          null,
          `We’ll leave invoice ${deal.invoiceNumber} on its original terms.`,
          [],
          2,
        ),
        this.moveDeal(
          deal.planItemId,
          'DECLINED',
          'OWNER',
          'You rejected the counter.',
          // The reason both sides read; the owner's own is in its history.
          { pendingApprovalId: null, closedReason: DECLINED },
          { side: 'SUPPLIER', publicReason: DECLINED },
        ),
        ...this.refreshed(),
      );
      return { approval, events };
    }

    const terms = approval.terms ?? bad('No terms');
    const bps = percentToBps(terms.discountPct);
    const early = toCents(terms.amountEarly);
    const plan = this.plan ?? bad('No plan');
    const cost = discountOn(early, bps);
    const costAfter = toCents(approval.costImpact?.planCostAfter ?? '0.00');
    const updated = this.offerItem(
      this.itemFor(deal.invoiceId),
      s,
      deal.action,
      early,
      bps,
      'OWNER_EDIT',
      'Counter you approved.',
    );
    this.plan = { ...plan, items: plan.items.map((i) => (i.id === updated.id ? updated : i)) };
    events.push(
      this.say(
        deal,
        s,
        'supplier',
        'COUNTER',
        terms,
        'We can do 1.2%, for $1,729 today.',
        [checkMaxDiscount(bps, bps), checkCostCeiling(costAfter, toCents(plan.costCeiling))],
        2,
      ),
      this.moveDeal(
        deal.planItemId,
        'SENT',
        'SUPPLIER_AGENT',
        'Counter sent after your approval.',
        {
          pendingApprovalId: null,
          currentTerms: terms,
          round: 2,
          cost: fromCents(cost),
          committedIfAgreed: fromCents(early - cost),
          impliedAnnualRate: impliedAnnualRate(bps, s.dueInDays),
        },
        { side: 'SUPPLIER', publicReason: COUNTERED },
      ),
      this.say(
        deal,
        s,
        'client',
        'ACCEPT',
        terms,
        'That works for us. Accepted.',
        [
          checkHurdleRate(bps, s.dueInDays, 1500),
          checkCashBuffer(50_000_00n, early - cost, 20_000_00n),
          checkAutoPayLimit(early - cost, 2_000_00n),
          checkEarlyPayCap(early, 5_000_00n),
        ],
        2,
      ),
      this.moveDeal(deal.planItemId, 'AGREED', 'CLIENT_AGENT', 'Both sides accepted these terms.', {
        agreedTerms: terms,
      }),
      this.record(
        deal.id,
        'INVOICE_UPDATED',
        'PayPal invoice updated with a discount and a partial-payment minimum.',
        'SYSTEM',
        'PUT /v2/invoicing/invoices/{id}',
      ),
      this.moveDeal(deal.planItemId, 'INVOICE_UPDATED', 'SYSTEM', 'PayPal invoice updated.'),
      this.record(
        deal.id,
        'ORDER_CREATED',
        'Order created from Harbor’s saved PayPal method.',
        'SYSTEM',
        'POST /v2/checkout/orders',
      ),
      this.moveDeal(
        deal.planItemId,
        'AWAITING_PAYMENT',
        'SYSTEM',
        'Waiting for PayPal to confirm the payment.',
      ),
      ...this.refreshed(),
    );
    return { approval, events };
  }

  /** Whether this deal waits for PayPal on a payment the client has approved. */
  paymentApproved(dealId: string): boolean {
    const deal = [...this.deals.values()].find((d) => d.id === dealId);
    return (
      deal?.state === 'AWAITING_PAYMENT' &&
      [...this.approvals.values()].some(
        (a) => a.dealId === dealId && a.type === 'CLIENT_PAYMENT' && a.decision === 'APPROVED',
      )
    );
  }

  /** PayPal's verified webhook for a payment on this deal: the only way a deal becomes PAID. */
  confirmPayment(dealId: string): ServerEvent[] {
    const deal = [...this.deals.values()].find((d) => d.id === dealId) ?? bad('No deal');
    if (deal.state !== 'AWAITING_PAYMENT') bad('This deal is not waiting for a payment.');
    const waiting = [...this.approvals.values()].some(
      (a) => a.dealId === dealId && a.decision === 'PENDING',
    );
    if (waiting) bad('A person has not approved this payment yet.');
    return [
      this.record(
        deal.id,
        'PAYMENT_RECORDED',
        'PayPal confirmed the payment (PAYMENT.CAPTURE.COMPLETED, verified).',
        'PAYPAL',
        null,
        true,
      ),
      this.moveDeal(deal.planItemId, 'PAID', 'PAYPAL', 'PayPal confirmed the payment.', {
        pendingApprovalId: null,
      }),
      ...this.refreshed(),
    ];
  }

  dealDetail(dealId: string): DealDetail | null {
    const deal = [...this.deals.values()].find((d) => d.id === dealId);
    if (!deal) return null;
    return {
      ...deal,
      paypal: {
        invoiceId: `INV2-${deal.invoiceNumber}-SBOX-0000-0000`,
        reissuedInvoiceId: null,
        orderId: null,
        captureId: null,
        invoicePaymentId: null,
        payerUrl: null,
      },
      messages: this.messages.get(dealId) ?? [],
      history: this.history.get(dealId) ?? [],
      approvals: [...this.approvals.values()].filter((a) => a.dealId === dealId),
    };
  }

  /** Newest first, as the API returns them. */
  auditFor(dealId: string | null): AuditEntry[] {
    return this.auditLog.filter((e) => dealId === null || e.dealId === dealId).toReversed();
  }

  listApprovals(): ApprovalView[] {
    return [...this.approvals.values()];
  }

  invoiceRows(): InvoiceRow[] {
    const plan = this.plan;
    const goal = this.goal;
    const blocked = new Set((goal?.doNotContact ?? []).map((d) => d.businessId));
    return INVOICES.map((s) => {
      const items = plan?.items.filter((i) => i.invoiceId === s.id) ?? [];
      const planItem = items.find((i) => i.rank === 'PRIMARY') ?? null;
      const dueDate = addDays(TODAY, s.dueInDays);
      return {
        id: s.id,
        paypalInvoiceId: `INV2-${s.number}-SBOX-0000-0000`,
        number: s.number,
        client: clientRef(s),
        amount: fromCents(s.amount),
        currency: 'USD',
        amountPaid: '0.00',
        amountDue: fromCents(s.amount),
        issueDate: addDays(dueDate, -30),
        dueDate,
        daysUntilDue: s.dueInDays,
        paypalStatus: s.dueInDays < 0 ? 'UNPAID' : 'SENT',
        contactAllowed: s.contactAllowed && !blocked.has(s.clientId),
        paypalUrl: null,
        isDemo: true,
        lastSyncedAt: '2026-11-09T09:55:00Z',
        planItem,
        backups: items.filter((i) => i.rank === 'BACKUP'),
        deal: planItem ? (this.deals.get(planItem.id) ?? null) : null,
      };
    });
  }

  runway(): RunwayResponse {
    const plan = this.plan;
    const plannedCommitted = plan ? toCents(plan.summary.plannedCommitted) : 0n;
    const committed = plan ? toCents(plan.summary.committed) : 0n;
    const bestEffort = plan ? toCents(plan.summary.bestEffort) : 0n;
    const points = Array.from({ length: 31 }, (_, day) => {
      const date = addDays(TODAY, day);
      const before = BALANCE - (date >= PAYROLL_DATE ? PAYROLL : 0n);
      const afterCommitted = before + committed;
      return {
        date,
        before: fromCents(before),
        afterCommitted: fromCents(afterCommitted),
        afterPlanned: fromCents(afterCommitted + plannedCommitted - committed),
        afterBestEffort: fromCents(afterCommitted + (day >= 2 ? bestEffort : 0n)),
      };
    });
    return {
      currency: 'USD',
      today: TODAY,
      asOf: '2026-11-09T09:55:00Z',
      balance: fromCents(BALANCE),
      planId: plan?.id ?? null,
      deadline: this.goal?.deadline ?? null,
      gap: this.goal?.amount ?? '0.00',
      committed: fromCents(committed),
      bestEffort: fromCents(bestEffort),
      thresholds: [{ label: 'Payroll', amount: fromCents(PAYROLL), date: PAYROLL_DATE }],
      points,
      events: [
        {
          date: PAYROLL_DATE,
          amount: fromCents(-PAYROLL),
          kind: 'PAYROLL',
          label: 'Payroll',
          committed: true,
        },
      ],
    };
  }
}

export const WORLD_TODAY = TODAY;
