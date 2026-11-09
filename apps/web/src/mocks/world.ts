import {
  type ActionType,
  addDays,
  type BusinessRef,
  bpsToPercent,
  type Cents,
  checkOverdueNoDiscount,
  type CurrentGoalResponse,
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
  normalizeMoneyInput,
  type Plan,
  type PlanItemView,
  type PlanSummary,
  type PolicyCheckView,
  percentToBps,
  type RunwayResponse,
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

export class PolicyBlockedError extends Error {
  constructor(readonly checks: PolicyCheckView[]) {
    super('Blocked by policy.');
  }
}

/** The API's 400 for an action that doesn't fit the amount. */
export class ShapeError extends Error {}

export class MockWorld {
  goal: Goal | null = null;
  plan: Plan | null = null;
  readonly deals = new Map<string, DealSummary>();
  private nowSeq = 0;

  private stamp(): string {
    this.nowSeq += 1;
    return `2026-11-09T10:${String(Math.min(this.nowSeq, 59)).padStart(2, '0')}:00Z`;
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
    const plan: Plan = {
      id: 'plan_1',
      goalId: goal.id,
      status: 'DRAFT',
      costCeiling: SUPPLIER_POLICY.costCeiling,
      approvedAt: null,
      createdAt: this.stamp(),
      summary: this.summaryFor(goal, items, SUPPLIER_POLICY.costCeiling),
      items,
    };
    this.plan = plan;
    this.goal = { ...goal, status: 'PLANNED', updatedAt: this.stamp() };
    this.deals.clear();
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
      // contracts-v2 (CR-1): rows carry the server's policy checks. The mock has none yet.
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
    const policy = {
      maxDiscountBps: percentToBps(goal.maxDiscountPct),
      doNotContact: goal.doNotContact.flatMap((d) => (d.businessId ? [d.businessId] : [])),
      costCeiling: toCents(plan.costCeiling),
    };
    const checks =
      next.action === 'NONE'
        ? []
        : next.action === 'REMINDER'
          ? evaluateReminder(policy, s.clientId)
          : evaluateSupplierTerms(policy, {
              clientId: s.clientId,
              amountDue: s.amount,
              dueDate: addDays(TODAY, s.dueInDays),
              amountEarly: toCents(next.amountEarly ?? '0.00'),
              discountBps: percentToBps(next.discountPct ?? '0.00'),
              payBy: next.payBy ?? TODAY,
              planCostIfAgreed,
              round: 1,
              today: TODAY,
            });
    // A cost over the ceiling needs the owner's approval, it is not a hard block.
    if (checks.some((c) => c.result === 'blocked')) throw new PolicyBlockedError(checks);

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
    return this.plan;
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
