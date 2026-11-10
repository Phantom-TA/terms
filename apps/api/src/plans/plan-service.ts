/**
 * Plans in the database: runs the planner on a goal and the supplier's open invoices, serves the
 * Workbench view, applies owner edits (validated by the policy layer), and approves a plan with
 * its cost ceiling. Nothing is sent to anyone here: approval creates APPROVED deals, and the deal
 * engine executes them.
 */
import {
  type ActionType,
  bpsToPercent,
  checkAmountWithinInvoice,
  checkDoNotContact,
  checkMaxDiscount,
  checkOverdueNoDiscount,
  checkPayByBeforeDue,
  diffDays,
  discountOn,
  formatMoney,
  impliedAnnualRate,
  isBlocked,
  isoDateInTimeZone,
  isCommitted,
  percentToBps,
  type Plan as PlanView,
  type PlanItemView,
  type PlanSummary,
  type PolicyCheck,
  PolicyCheckView,
  toCents,
  type UpdatePlanItemRequest,
} from '@terms/shared';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx } from '../db.js';
import { type DealStore } from '../deals/deal-store.js';
import { AppError, conflict, notFound, policyBlocked } from '../errors.js';
import { type Goal, type Prisma } from '../generated/prisma/client.js';
import { dateToIso, isoToDate, money } from '../mappers.js';
import {
  buildPlan,
  isGoalMet,
  type PlannerInput,
  type PlannerInvoice,
  targetFor,
} from '../planner/planner.js';

const OFFER_ACTIONS: readonly ActionType[] = ['PARTIAL_PAYMENT', 'EARLY_DISCOUNT', 'NEGOTIATE'];
/** What the planner would do with a different maximum discount (nothing is saved). */
export interface CapSimulation {
  maxDiscountPct: string;
  target: string;
  plannedCommitted: string;
  plannedCost: string;
  shortfall: boolean;
  offers: {
    invoiceNumber: string;
    client: string;
    action: string;
    discountPct: string | null;
    amountEarly: string | null;
    payBy: string | null;
    cost: string;
    committedIfAgreed: string;
  }[];
}

const OPEN_STATUSES = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED', 'PAYMENT_PENDING'] as const;

export function isOfferAction(action: ActionType): boolean {
  return OFFER_ACTIONS.includes(action);
}

/** The terms of one plan row that the policy layer checks. */
export interface RowTerms {
  action: ActionType;
  clientId: string;
  discountBps: number | null;
  amountEarly: bigint | null;
}

/** What the row's checks are evaluated against. */
export interface RowPolicyContext {
  doNotContact: readonly string[];
  maxDiscountBps: number;
  amountDue: bigint;
  dueDate: string;
  today: string;
}

/**
 * The policy checks for one plan row, the same ones the planner and owner edits are held to.
 * NONE rows carry only a failed do-not-contact check (so the Workbench can show why the client is
 * left alone); other NONE rows have nothing to check.
 */
export function rowPolicyChecks(row: RowTerms, ctx: RowPolicyContext): PolicyCheck[] {
  const contact = checkDoNotContact(row.clientId, ctx.doNotContact);
  if (row.action === 'NONE') return contact.result === 'pass' ? [] : [contact];
  if (row.action === 'REMINDER') return [contact];
  const discountBps = row.discountBps ?? 0;
  return [
    contact,
    checkMaxDiscount(discountBps, ctx.maxDiscountBps),
    checkOverdueNoDiscount(discountBps, ctx.dueDate, ctx.today),
    checkAmountWithinInvoice(row.amountEarly ?? ctx.amountDue, ctx.amountDue),
    checkPayByBeforeDue(ctx.today, ctx.dueDate),
  ];
}

const planInclude = {
  goal: true,
  items: {
    include: {
      invoice: { include: { client: true } },
      deal: { select: { id: true, state: true } },
    },
    orderBy: [
      { rank: 'asc' },
      { backupOrder: 'asc' },
      { invoice: { dueDate: 'asc' } },
      { invoice: { number: 'asc' } },
    ],
  },
  deals: { select: { state: true, action: true, committedCents: true, costCents: true } },
} satisfies Prisma.PlanInclude;

type PlanWithItems = Prisma.PlanGetPayload<{ include: typeof planInclude }>;
type ItemWithInvoice = PlanWithItems['items'][number];

export class PlanService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly deals: DealStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** "Today" in the supplier's time zone. */
  private async today(db: DbOrTx, supplierId: string): Promise<string> {
    const business = await db.business.findUniqueOrThrow({
      where: { id: supplierId },
      select: { timeZone: true },
    });
    return isoDateInTimeZone(this.now(), business.timeZone);
  }

  /** Runs the planner on a goal; replaces any earlier DRAFT plan of that goal. */
  /** What the planner needs for a goal: the supplier's open invoices and the goal's limits. */
  private async plannerInputs(db: DbOrTx, goal: Goal, today: string) {
    const policy = await db.supplierPolicy.findUnique({ where: { businessId: goal.supplierId } });
    const invoices = await db.invoice.findMany({
      where: {
        supplierId: goal.supplierId,
        paypalStatus: { in: [...OPEN_STATUSES] },
        amountDueCents: { gt: 0 },
      },
      include: { client: true },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    });
    const doNotContact = [...new Set([...goal.doNotContactIds, ...(policy?.doNotContact ?? [])])];
    const plannerInvoices: PlannerInvoice[] = invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      clientId: inv.clientId,
      clientName: inv.client.name,
      clientHasAgent: inv.client.hasAgent,
      amountDue: inv.amountDueCents,
      dueDate: dateToIso(inv.dueDate),
    }));
    const input: PlannerInput = {
      today,
      deadline: dateToIso(goal.deadline),
      gap: goal.amountCents,
      bufferBps: goal.bufferBps,
      maxDiscountBps: goal.maxDiscountBps,
      openingDiscountBps: goal.openingDiscountBps,
      doNotContact,
      invoices: plannerInvoices,
    };
    return { policy, invoices, doNotContact, input };
  }

  /**
   * What the planner would do for a goal with a different maximum discount, without saving
   * anything: the owner's "what if I allowed 1.5%?" (CONTEXT.md, Cash Studio). Read-only.
   */
  async simulateCap(
    goalId: string,
    supplierId: string,
    maxDiscountBps: number,
  ): Promise<CapSimulation> {
    const goal = await this.db.goal.findUnique({ where: { id: goalId } });
    if (goal?.supplierId !== supplierId) throw notFound('Goal');
    const today = await this.today(this.db, supplierId);
    const { invoices, input } = await this.plannerInputs(this.db, goal, today);
    const result = buildPlan({
      ...input,
      maxDiscountBps,
      openingDiscountBps: Math.min(input.openingDiscountBps, maxDiscountBps),
    });
    const byId = new Map(invoices.map((inv) => [inv.id, inv]));
    return {
      maxDiscountPct: bpsToPercent(maxDiscountBps),
      target: money(result.target),
      plannedCommitted: money(result.plannedCommitted),
      plannedCost: money(result.plannedCost),
      shortfall: result.shortfall,
      offers: result.rows
        .filter((r) => r.rank === 'PRIMARY' && isOfferAction(r.action))
        .map((r) => ({
          invoiceNumber: byId.get(r.invoiceId)?.number ?? '',
          client: byId.get(r.invoiceId)?.client.name ?? '',
          action: r.action,
          discountPct: r.discountBps === null ? null : bpsToPercent(r.discountBps),
          amountEarly: r.amountEarly === null ? null : money(r.amountEarly),
          payBy: r.payBy,
          cost: money(r.cost),
          committedIfAgreed: money(r.committedIfAgreed),
        })),
    };
  }

  async createPlan(goalId: string, costCeiling?: bigint): Promise<string> {
    return this.db.$transaction(async (tx) => {
      const goal = await tx.goal.findUnique({ where: { id: goalId } });
      if (goal === null) throw notFound('Goal');
      if (goal.status === 'ACTIVE' || goal.status === 'MET' || goal.status === 'CANCELLED') {
        throw conflict(`Goal is ${goal.status.toLowerCase()}; start a new goal to re-plan`);
      }
      const today = await this.today(tx, goal.supplierId);
      const { policy, invoices, doNotContact, input } = await this.plannerInputs(tx, goal, today);
      const result = buildPlan(input);

      await tx.plan.updateMany({
        where: { goalId, status: 'DRAFT' },
        data: { status: 'CANCELLED' },
      });
      const plan = await tx.plan.create({
        data: {
          goalId,
          costCeilingCents: costCeiling ?? policy?.costCeilingCents ?? result.plannedCost,
        },
      });
      const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));
      await tx.planItem.createMany({
        data: result.rows.map((r) => {
          const inv = invoiceById.get(r.invoiceId);
          if (inv === undefined) throw new Error(`Planner returned unknown invoice ${r.invoiceId}`);
          const checks = rowPolicyChecks(
            { ...r, clientId: inv.clientId },
            {
              doNotContact,
              maxDiscountBps: goal.maxDiscountBps,
              amountDue: inv.amountDueCents,
              dueDate: dateToIso(inv.dueDate),
              today,
            },
          );
          return {
            planId: plan.id,
            invoiceId: r.invoiceId,
            action: r.action,
            rank: r.rank,
            backupOrder: r.backupOrder,
            discountBps: r.discountBps,
            amountEarlyCents: r.amountEarly,
            payBy: r.payBy === null ? null : isoToDate(r.payBy),
            costCents: r.cost,
            committedIfAgreedCents: r.committedIfAgreed,
            reasonCode: r.reasonCode,
            reason: r.reason,
            policyChecks: checks.map((c) => ({ ...c })),
          };
        }),
      });
      await tx.goal.update({ where: { id: goalId }, data: { status: 'PLANNED' } });
      await this.audit.write(tx, {
        actor: 'SYSTEM',
        action: 'PLAN_CREATED',
        subjectType: 'PLAN',
        subjectId: plan.id,
        businessIds: [goal.supplierId],
        summary: `Plan commits ${formatMoney(result.plannedCommitted)} against ${formatMoney(result.target)} for ${formatMoney(result.plannedCost)}${result.shortfall ? ' (short of the target)' : ''}`,
        details: {
          goalId,
          today,
          doNotContact,
          rows: result.rows.map((r) => ({
            invoiceId: r.invoiceId,
            action: r.action,
            rank: r.rank,
            discountBps: r.discountBps,
            amountEarly: r.amountEarly,
            cost: r.cost,
            reasonCode: r.reasonCode,
          })),
        },
      });
      return plan.id;
    });
  }

  private async load(db: DbOrTx, planId: string): Promise<PlanWithItems> {
    const plan = await db.plan.findUnique({ where: { id: planId }, include: planInclude });
    if (plan === null) throw notFound('Plan');
    return plan;
  }

  /** The plan as the Workbench sees it. `supplierId` scopes access to the owner's own plans. */
  async getView(planId: string, supplierId: string, db: DbOrTx = this.db): Promise<PlanView> {
    const plan = await this.load(db, planId);
    if (plan.goal.supplierId !== supplierId) throw notFound('Plan');
    return toPlanView(plan);
  }

  /** Owner edits one row of a DRAFT plan. Blocked edits are rejected with POLICY_BLOCKED. */
  async editItem(
    planId: string,
    itemId: string,
    supplierId: string,
    edit: UpdatePlanItemRequest,
  ): Promise<{ plan: PlanView; policyChecks: PolicyCheck[] }> {
    return this.db.$transaction(async (tx) => {
      const plan = await this.load(tx, planId);
      if (plan.goal.supplierId !== supplierId) throw notFound('Plan');
      if (plan.status !== 'DRAFT') throw conflict('Only a draft plan can be edited');
      const item = plan.items.find((i) => i.id === itemId);
      if (item === undefined) throw notFound('Plan item');

      const policy = await tx.supplierPolicy.findUnique({ where: { businessId: supplierId } });
      const doNotContact = [
        ...new Set([...plan.goal.doNotContactIds, ...(policy?.doNotContact ?? [])]),
      ];
      const today = await this.today(tx, supplierId);
      const inv = item.invoice;
      const dueDate = dateToIso(inv.dueDate);

      let action: ActionType = edit.excluded === true ? 'NONE' : (edit.action ?? item.action);
      let data: Prisma.PlanItemUpdateInput;
      let terms: { discountBps: number | null; amountEarly: bigint | null } = {
        discountBps: null,
        amountEarly: null,
      };

      if (action === 'NONE') {
        data = {
          action,
          discountBps: null,
          amountEarlyCents: null,
          payBy: null,
          costCents: 0n,
          committedIfAgreedCents: 0n,
          reasonCode: edit.excluded === true ? 'OWNER_EXCLUDED' : 'OWNER_EDIT',
          reason: edit.excluded === true ? 'Excluded by you.' : 'No action, set by you.',
        };
      } else if (action === 'REMINDER') {
        data = {
          action,
          discountBps: null,
          amountEarlyCents: null,
          payBy: null,
          costCents: 0n,
          committedIfAgreedCents: 0n,
          reasonCode: 'OWNER_EDIT',
          reason: 'Reminder, set by you. Best effort, not counted.',
        };
      } else {
        const discountBps =
          edit.discountPct === undefined
            ? (item.discountBps ?? plan.goal.openingDiscountBps)
            : percentToBps(edit.discountPct);
        const amountEarly =
          edit.amountEarly === undefined
            ? (item.amountEarlyCents ?? inv.amountDueCents)
            : toCents(edit.amountEarly);
        if (edit.action === undefined) {
          action = inv.client.hasAgent
            ? 'NEGOTIATE'
            : amountEarly < inv.amountDueCents
              ? 'PARTIAL_PAYMENT'
              : 'EARLY_DISCOUNT';
        }
        if (action === 'NEGOTIATE' && !inv.client.hasAgent) {
          throw new AppError('VALIDATION_FAILED', `${inv.client.name} does not run an agent`, {
            issues: [{ path: 'action', message: 'NEGOTIATE needs a client agent' }],
          });
        }
        if (action === 'EARLY_DISCOUNT' && amountEarly !== inv.amountDueCents) {
          throw new AppError(
            'VALIDATION_FAILED',
            'An early-payment discount covers the whole amount due',
            {
              issues: [
                { path: 'amountEarly', message: 'Use PARTIAL_PAYMENT for part of the invoice' },
              ],
            },
          );
        }
        if (action === 'PARTIAL_PAYMENT' && amountEarly >= inv.amountDueCents) {
          throw new AppError(
            'VALIDATION_FAILED',
            'A partial payment must be less than the amount due',
            {
              issues: [{ path: 'amountEarly', message: 'Use EARLY_DISCOUNT for the whole amount' }],
            },
          );
        }
        terms = { discountBps, amountEarly };
        const cost = discountOn(amountEarly, discountBps);
        data = {
          action,
          discountBps,
          amountEarlyCents: amountEarly,
          payBy: isoToDate(today),
          costCents: cost,
          committedIfAgreedCents: amountEarly - cost,
          reasonCode: 'OWNER_EDIT',
          reason: `Set by you: ${formatMoney(amountEarly)} at ${bpsToPercent(discountBps)}%, commits ${formatMoney(amountEarly - cost)} for ${formatMoney(cost)}.`,
        };
      }

      const checks = rowPolicyChecks(
        { action, clientId: inv.clientId, ...terms },
        {
          doNotContact,
          maxDiscountBps: plan.goal.maxDiscountBps,
          amountDue: inv.amountDueCents,
          dueDate,
          today,
        },
      );
      // Taking no action never breaks policy, even for a protected client.
      if (action !== 'NONE' && isBlocked(checks)) {
        throw policyBlocked('This change breaks your policy', checks);
      }
      await tx.planItem.update({
        where: { id: item.id },
        data: {
          ...data,
          editedByOwner: true,
          explanation: null,
          policyChecks: checks.map((c) => ({ ...c })),
        },
      });
      await this.audit.write(tx, {
        actor: 'OWNER',
        action: 'PLAN_ITEM_EDITED',
        subjectType: 'PLAN_ITEM',
        subjectId: item.id,
        businessIds: [supplierId],
        summary: `Row for invoice ${inv.number} changed to ${action}`,
        details: { planId, edit, policyChecks: checks },
      });
      return { plan: toPlanView(await this.load(tx, planId)), policyChecks: checks };
    });
  }

  /**
   * The owner approves the plan and its cost ceiling. Every primary row with an action becomes
   * an APPROVED deal; nothing is sent here.
   */
  async approve(planId: string, supplierId: string, costCeiling: bigint): Promise<PlanView> {
    return this.db.$transaction(
      async (tx) => {
        const plan = await this.load(tx, planId);
        if (plan.goal.supplierId !== supplierId) throw notFound('Plan');
        if (plan.status !== 'DRAFT') throw conflict(`Plan is already ${plan.status.toLowerCase()}`);
        const summary = summarize(plan);
        if (toCents(summary.plannedCost) > costCeiling) {
          throw policyBlocked('The plan costs more than the ceiling you set', [
            {
              rule: 'costCeiling',
              result: 'blocked',
              detail: `Planned cost ${formatMoney(summary.plannedCost)} is above the ${formatMoney(costCeiling)} ceiling`,
            },
          ]);
        }
        const now = this.now();
        await tx.plan.update({
          where: { id: planId },
          data: { status: 'APPROVED', approvedAt: now, costCeilingCents: costCeiling },
        });
        await tx.goal.update({ where: { id: plan.goalId }, data: { status: 'ACTIVE' } });

        for (const item of plan.items) {
          if (item.rank !== 'PRIMARY' || item.action === 'NONE') continue;
          const deal = await tx.deal.create({
            data: {
              planItemId: item.id,
              planId,
              invoiceId: item.invoiceId,
              clientId: item.invoice.clientId,
              action: item.action,
              paypalInvoiceId: item.invoice.paypalInvoiceId,
              costCents: item.costCents,
              committedCents: item.committedIfAgreedCents,
            },
          });
          await this.deals.transition(
            {
              dealId: deal.id,
              to: 'APPROVED',
              actor: 'OWNER',
              // The ceiling is the owner's business; the client reads a plain approval.
              reason: 'Approved',
              privateReason: {
                side: 'SUPPLIER',
                reason: `Approved in plan with a ${formatMoney(costCeiling)} ceiling`,
              },
            },
            tx,
          );
        }

        // The owner's approval is the request itself, so it is recorded as already decided.
        await tx.approval.create({
          data: {
            type: 'PLAN',
            subjectType: 'PLAN',
            subjectId: planId,
            requestedFrom: 'OWNER',
            businessId: supplierId,
            decision: 'APPROVED',
            title: 'Plan approved',
            summary: `Commit ${formatMoney(summary.plannedCommitted)} against ${formatMoney(summary.target)} for ${formatMoney(summary.plannedCost)}`,
            planId,
            decidedAt: now,
            decidedBy: 'OWNER',
          },
        });
        await this.audit.write(tx, {
          actor: 'OWNER',
          action: 'PLAN_APPROVED',
          subjectType: 'PLAN',
          subjectId: planId,
          businessIds: [supplierId],
          summary: `Plan approved with a ${formatMoney(costCeiling)} cost ceiling`,
          details: { costCeiling, plannedCost: summary.plannedCost },
        });
        return toPlanView(await this.load(tx, planId));
      },
      { isolationLevel: 'Serializable', timeout: 20_000 },
    );
  }
}

function itemView(item: ItemWithInvoice): PlanItemView {
  const due = dateToIso(item.invoice.dueDate);
  const payBy = item.payBy === null ? null : dateToIso(item.payBy);
  const daysEarly = payBy === null ? null : diffDays(due, payBy);
  const offer = isOfferAction(item.action);
  return {
    id: item.id,
    planId: item.planId,
    invoiceId: item.invoiceId,
    invoiceNumber: item.invoice.number,
    client: {
      id: item.invoice.client.id,
      name: item.invoice.client.name,
      slug: item.invoice.client.slug,
      hasAgent: item.invoice.client.hasAgent,
    },
    action: item.action,
    rank: item.rank,
    backupOrder: item.backupOrder,
    discountPct: item.discountBps === null ? null : bpsToPercent(item.discountBps),
    amountEarly: item.amountEarlyCents === null ? null : money(item.amountEarlyCents),
    payBy,
    daysEarly: daysEarly !== null && daysEarly >= 1 ? daysEarly : null,
    impliedAnnualRate:
      item.discountBps !== null && daysEarly !== null && daysEarly >= 1
        ? impliedAnnualRate(item.discountBps, daysEarly)
        : null,
    cost: money(item.costCents),
    committedIfAgreed: money(item.committedIfAgreedCents),
    countsTowardGoal: offer,
    reasonCode: item.reasonCode,
    reason: item.reason,
    explanation: item.explanation,
    editedByOwner: item.editedByOwner,
    policyChecks: PolicyCheckView.array().parse(item.policyChecks),
    dealId: item.deal?.id ?? null,
    dealState: item.deal?.state ?? null,
  };
}

export function summarize(plan: PlanWithItems): PlanSummary {
  const { target, buffer } = targetFor(plan.goal.amountCents, plan.goal.bufferBps);
  let plannedCommitted = 0n;
  let plannedCost = 0n;
  let bestEffort = 0n;
  for (const item of plan.items) {
    if (item.rank !== 'PRIMARY') continue;
    if (isOfferAction(item.action)) {
      plannedCommitted += item.committedIfAgreedCents;
      plannedCost += item.costCents;
    } else if (item.action === 'REMINDER') {
      bestEffort += item.invoice.amountDueCents;
    }
  }
  let committed = 0n;
  let costSoFar = 0n;
  let paid = 0n;
  for (const d of plan.deals) {
    if (d.action === 'REMINDER' || !isCommitted(d.state)) continue;
    committed += d.committedCents;
    costSoFar += d.costCents;
    if (d.state === 'PAID' || d.state === 'PARTIALLY_PAID') paid += d.committedCents;
  }
  const remaining = target > committed ? target - committed : 0n;
  return {
    gap: money(plan.goal.amountCents),
    buffer: money(buffer),
    target: money(target),
    plannedCommitted: money(plannedCommitted),
    plannedCost: money(plannedCost),
    committed: money(committed),
    paid: money(paid),
    costSoFar: money(costSoFar),
    bestEffort: money(bestEffort),
    costCeiling: money(plan.costCeilingCents),
    remaining: money(remaining),
    goalMet: isGoalMet(committed, target),
    shortfall: plannedCommitted < target,
  };
}

export function toPlanView(plan: PlanWithItems): PlanView {
  return {
    id: plan.id,
    goalId: plan.goalId,
    status: plan.status,
    costCeiling: money(plan.costCeilingCents),
    approvedAt: plan.approvedAt?.toISOString() ?? null,
    createdAt: plan.createdAt.toISOString(),
    summary: summarize(plan),
    items: plan.items.map(itemView),
  };
}
