/**
 * The deal runner: executes an approved plan (CONTEXT.md, "How it works" steps 4–6). For each
 * deal it takes the next step the deal's state allows, and it stops whenever a person, the owner
 * or PayPal has to act:
 *  - APPROVED: send the reminder (PayPal), or send the offer (negotiation engine);
 *  - SENT / COUNTERED with a client agent: let the agents move;
 *  - AGREED: put the agreed terms on the PayPal invoice;
 *  - AWAITING_PAYMENT: a client agent with a saved PayPal method pays, within its limit or with
 *    its person's approval; otherwise the person pays the PayPal invoice.
 * After every pass it applies the stop rule (committed ≥ target: withdraw what is still open) and
 * runs backups when the open offers can no longer reach the target, within the cost ceiling or
 * with the owner's approval above it.
 * Runs are serialized per plan; nothing here marks a deal paid (only settlement does).
 */
import { type DealState, formatMoney, isCommitted, isFinal, toCents } from '@terms/shared';
import { type ApprovalService } from '../approvals/approval-service.js';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx } from '../db.js';
import { type Approval } from '../generated/prisma/client.js';
import { type EventBus } from '../http/events.js';
import { type Logger } from '../logger.js';
import { money } from '../mappers.js';
import { type NegotiationEngine } from '../negotiation/engine.js';
import { type PlanService } from '../plans/plan-service.js';
import { type DealStore } from './deal-store.js';

export interface RunnerPayPal {
  remind: (dealId: string) => Promise<unknown>;
  applyTerms: (dealId: string) => Promise<unknown>;
  payWithVault: (dealId: string) => Promise<unknown>;
}

export interface RunnerDeps {
  db: Db;
  deals: DealStore;
  engine: NegotiationEngine;
  plans: PlanService;
  approvals: ApprovalService;
  audit: AuditLogger;
  events: EventBus;
  logger: Logger;
  publishDeals: (dealIds: readonly string[]) => Promise<void>;
  /** Issues the offer page link for a client without an agent. */
  issueOfferLink: (dealId: string) => Promise<void>;
  /** Null when PayPal is not configured: deals wait at the first PayPal step. */
  paypal: RunnerPayPal | null;
}

const OPEN: readonly DealState[] = ['APPROVED', 'SENT', 'COUNTERED', 'NEEDS_OWNER'];
/** At most this many steps per deal per pass, so a misbehaving deal can never spin. */
const MAX_STEPS = 12;

export class DealRunner {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly d: RunnerDeps) {
    d.approvals.onDecision('BACKUP_OVER_CEILING', (tx, approval) =>
      this.onBackupDecision(tx, approval),
    );
  }

  /** Runs the plan in the background, after any run already queued for it. */
  kick(planId: string): void {
    const previous = this.queues.get(planId) ?? Promise.resolve();
    const next = previous
      .then(() => this.runPlan(planId))
      .catch((err: unknown) => {
        this.d.logger.error({ err, planId }, 'plan run failed');
      });
    this.queues.set(planId, next);
    void next.finally(() => {
      if (this.queues.get(planId) === next) this.queues.delete(planId);
    });
  }

  /** Resolves when every queued run has finished (tests and graceful shutdown). */
  async drain(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
  }

  async runPlan(planId: string): Promise<void> {
    const plan = await this.d.db.plan.findUnique({
      where: { id: planId },
      include: { goal: true },
    });
    if (plan === null || (plan.status !== 'APPROVED' && plan.status !== 'MET')) return;
    const deals = await this.d.db.deal.findMany({
      where: { planId },
      orderBy: { createdAt: 'asc' },
    });
    for (const deal of deals) {
      if (isFinal(deal.state)) continue;
      await this.advance(deal.id);
      if (await this.stopRule(planId)) return;
    }
    await this.runBackups(planId);
  }

  /** Takes every step a deal allows right now. */
  async advance(dealId: string): Promise<void> {
    for (let step = 0; step < MAX_STEPS; step++) {
      const deal = await this.d.deals.get(this.d.db, dealId);
      const before = `${deal.state}:${String(deal.version)}`;
      try {
        await this.step(dealId);
      } catch (err) {
        // The services record PayPal refusals on the deal and the audit trail; log the rest.
        this.d.logger.warn({ err, dealId, state: deal.state }, 'deal step stopped');
        await this.d.publishDeals([dealId]);
        return;
      }
      const after = await this.d.deals.get(this.d.db, dealId);
      await this.d.publishDeals([dealId]);
      if (`${after.state}:${String(after.version)}` === before) return; // waiting on someone
    }
  }

  private async step(dealId: string): Promise<void> {
    const deal = await this.d.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: { client: true },
    });
    const paypal = this.d.paypal;
    switch (deal.state) {
      case 'APPROVED':
        if (deal.action === 'REMINDER') {
          if (paypal !== null) await paypal.remind(dealId);
        } else if (deal.action !== 'NONE') {
          await this.d.engine.sendOffer(dealId);
          if (!deal.client.hasAgent) await this.d.issueOfferLink(dealId);
        }
        return;
      case 'SENT':
      case 'COUNTERED':
        // Agents answer here; a person answers on the offer page.
        if (deal.client.hasAgent || deal.state === 'COUNTERED')
          await this.d.engine.runAgents(dealId);
        return;
      case 'AGREED':
        if (paypal !== null) await paypal.applyTerms(dealId);
        return;
      case 'AWAITING_PAYMENT': {
        if (paypal === null || !deal.client.hasAgent || deal.paypalOrderId !== null) return;
        const vault = await this.d.db.vaultToken.findFirst({
          where: { clientId: deal.clientId, status: 'ACTIVE' },
        });
        if (vault === null) return; // the person pays the PayPal invoice
        const waiting = await this.d.db.approval.findFirst({
          where: {
            dealId,
            type: 'CLIENT_PAYMENT',
            decision: { in: ['PENDING', 'REJECTED', 'EXPIRED'] },
          },
        });
        if (waiting !== null) return; // above the limit and not (or not yet) approved
        await paypal.payWithVault(dealId);
        return;
      }
      default:
        return;
    }
  }

  /**
   * The stop rule (CONTEXT.md planner rule 5): once committed cash covers the target, withdraw
   * offers still open and their pending approvals, and mark the goal met. Returns whether met.
   */
  async stopRule(planId: string): Promise<boolean> {
    const plan = await this.d.db.plan.findUniqueOrThrow({
      where: { id: planId },
      include: { goal: true },
    });
    const view = await this.d.plans.getView(planId, plan.goal.supplierId);
    if (!view.summary.goalMet) return false;
    // Open offers are withdrawn; a reminder already sent stays (best effort, never withdrawn).
    const open = await this.d.db.deal.findMany({
      where: { planId, state: { in: [...OPEN] }, action: { not: 'REMINDER' } },
    });
    await this.d.db.$transaction(async (tx) => {
      for (const deal of open) {
        await this.d.deals.transition(
          {
            dealId: deal.id,
            to: 'WITHDRAWN',
            actor: 'SYSTEM',
            reason: 'Goal met: no longer needed',
            patch: { closedReason: 'Goal met' },
          },
          tx,
        );
        const pending = await tx.approval.findMany({
          where: { dealId: deal.id, decision: 'PENDING' },
        });
        for (const a of pending) await this.d.approvals.withdraw(tx, a.id, 'Goal met');
      }
      if (plan.goal.status !== 'MET') {
        await tx.goal.update({ where: { id: plan.goalId }, data: { status: 'MET' } });
        await tx.plan.update({ where: { id: planId }, data: { status: 'MET' } });
        await this.d.audit.write(tx, {
          actor: 'SYSTEM',
          action: 'GOAL_MET',
          subjectType: 'GOAL',
          subjectId: plan.goalId,
          businessIds: [plan.goal.supplierId],
          summary: `Goal met: ${formatMoney(toCents(view.summary.committed))} committed against ${formatMoney(toCents(view.summary.target))} for ${formatMoney(toCents(view.summary.costSoFar))}`,
          details: { withdrawn: open.map((d) => d.id) },
        });
      }
    });
    await this.d.publishDeals(open.map((d) => d.id));
    if (plan.goal.status !== 'MET') {
      await this.d.events.publish([plan.goal.supplierId], {
        type: 'goal.met',
        data: {
          goalId: plan.goalId,
          planId,
          target: view.summary.target,
          committed: view.summary.committed,
          cost: view.summary.costSoFar,
          withdrawnDealIds: open.map((d) => d.id),
        },
      });
    }
    return true;
  }

  /**
   * Backups (CONTEXT.md planner rule 4): when what is committed plus what is still open cannot
   * reach the target, the next backup runs automatically if the plan stays under its ceiling;
   * above it, the owner is asked.
   */
  async runBackups(planId: string): Promise<void> {
    const plan = await this.d.db.plan.findUniqueOrThrow({
      where: { id: planId },
      include: { goal: true, items: { include: { deal: true, invoice: true } }, deals: true },
    });
    if (plan.goal.status === 'MET') return;
    const view = await this.d.plans.getView(planId, plan.goal.supplierId);
    const target = toCents(view.summary.target);
    const live = plan.deals.filter(
      (d) => d.action !== 'REMINDER' && (isCommitted(d.state) || OPEN.includes(d.state)),
    );
    const reachable = live.reduce((sum, d) => sum + d.committedCents, 0n);
    if (reachable >= target) return;
    const cost = live.reduce((sum, d) => sum + d.costCents, 0n);
    const next = plan.items
      .filter((i) => i.rank === 'BACKUP' && i.deal === null && i.action !== 'NONE')
      .sort((a, b) => (a.backupOrder ?? 0) - (b.backupOrder ?? 0))[0];
    if (next === undefined) return;
    if (
      await this.d.db.approval.findFirst({
        where: { planId, type: 'BACKUP_OVER_CEILING', decision: 'PENDING' },
      })
    )
      return;

    if (cost + next.costCents > plan.costCeilingCents) {
      await this.d.approvals.request(this.d.db, {
        type: 'BACKUP_OVER_CEILING',
        subjectType: 'PLAN_ITEM',
        subjectId: next.id,
        requestedFrom: 'OWNER',
        businessId: plan.goal.supplierId,
        visibleTo: [],
        title: `Run backup: invoice ${next.invoice.number}`,
        summary: `Short of the target by ${formatMoney(target - reachable)}. The next backup costs ${formatMoney(next.costCents)}, taking the plan to ${formatMoney(cost + next.costCents)} against your ${formatMoney(plan.costCeilingCents)} ceiling.`,
        planId,
        costImpact: {
          planCostBefore: money(cost),
          planCostAfter: money(cost + next.costCents),
          delta: money(next.costCents),
          ceiling: money(plan.costCeilingCents),
          overCeilingBy: money(cost + next.costCents - plan.costCeilingCents),
        },
        actor: 'SYSTEM',
      });
      return;
    }
    const dealId = await this.launchBackup(
      this.d.db,
      next.id,
      'Backup within the approved ceiling',
    );
    await this.advance(dealId);
    await this.stopRule(planId);
  }

  private async launchBackup(db: DbOrTx, itemId: string, reason: string): Promise<string> {
    const item = await db.planItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { invoice: true },
    });
    const deal = await db.deal.create({
      data: {
        planItemId: item.id,
        planId: item.planId,
        invoiceId: item.invoiceId,
        clientId: item.invoice.clientId,
        action: item.action,
        paypalInvoiceId: item.invoice.paypalInvoiceId,
        costCents: item.costCents,
        committedCents: item.committedIfAgreedCents,
      },
    });
    // The owner approved this backup with the plan (within its ceiling) or explicitly.
    await this.d.deals.transition({ dealId: deal.id, to: 'APPROVED', actor: 'OWNER', reason }, db);
    return deal.id;
  }

  private async onBackupDecision(tx: DbOrTx, approval: Approval): Promise<void> {
    if (approval.decision !== 'APPROVED' || approval.planId === null) return;
    await this.launchBackup(
      tx,
      approval.subjectId,
      'Backup approved by the owner over the ceiling',
    );
  }
}
