/**
 * Approvals (CONTEXT.md principle 3): the owner approves plans, counters over the plan and
 * backups over the ceiling; a person at the client approves payments above its auto-pay limit.
 * An approval is decided once, only by the business it is addressed to, and only while pending
 * and unexpired. Effects of a decision run in the same transaction through registered handlers.
 */
import {
  type Actor,
  type ApprovalDecision,
  type ApprovalRequestedFrom,
  type ApprovalType,
  type ApprovalView,
  type CostImpact,
  NegotiationTerms,
  type SubjectType,
} from '@terms/shared';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx, type DbTx } from '../db.js';
import { AppError, conflict, forbidden, notFound } from '../errors.js';
import { type Approval } from '../generated/prisma/client.js';
import { moneyOrNull } from '../mappers.js';
import { termsJson } from '../deals/deal-store.js';

export interface ApprovalRequest {
  type: ApprovalType;
  subjectType: SubjectType;
  subjectId: string;
  requestedFrom: ApprovalRequestedFrom;
  /** The business whose session may decide it. */
  businessId: string;
  /** Businesses that may see it in the audit trail (always includes `businessId`). */
  visibleTo: readonly string[];
  title: string;
  summary: string;
  planId?: string | null;
  dealId?: string | null;
  terms?: NegotiationTerms | null;
  paymentAmountCents?: bigint | null;
  costImpact?: CostImpact | null;
  expiresAt?: Date | null;
  actor: Actor;
}

export type ApprovalHandler = (tx: DbTx, approval: Approval) => Promise<void>;

export function toApprovalView(row: Approval): ApprovalView {
  const terms = NegotiationTerms.safeParse(row.terms);
  return {
    id: row.id,
    type: row.type,
    requestedFrom: row.requestedFrom,
    decision: row.decision,
    title: row.title,
    summary: row.summary,
    planId: row.planId,
    dealId: row.dealId,
    terms: terms.success ? terms.data : null,
    paymentAmount: moneyOrNull(row.paymentAmountCents),
    costImpact: (row.costImpact ?? null) as CostImpact | null,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
  };
}

export class ApprovalService {
  private readonly handlers = new Map<ApprovalType, ApprovalHandler>();

  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Registers what happens when an approval of `type` is APPROVED or REJECTED. */
  onDecision(type: ApprovalType, handler: ApprovalHandler): void {
    this.handlers.set(type, handler);
  }

  /** Creates a pending approval, or returns the pending one for the same type and subject. */
  async request(tx: DbOrTx, req: ApprovalRequest): Promise<Approval> {
    const existing = await tx.approval.findFirst({
      where: {
        type: req.type,
        subjectType: req.subjectType,
        subjectId: req.subjectId,
        decision: 'PENDING',
      },
    });
    if (existing !== null) return existing;
    const row = await tx.approval.create({
      data: {
        type: req.type,
        subjectType: req.subjectType,
        subjectId: req.subjectId,
        requestedFrom: req.requestedFrom,
        businessId: req.businessId,
        title: req.title,
        summary: req.summary,
        planId: req.planId ?? null,
        dealId: req.dealId ?? null,
        ...(req.terms === undefined || req.terms === null ? {} : { terms: termsJson(req.terms) }),
        paymentAmountCents: req.paymentAmountCents ?? null,
        ...(req.costImpact === undefined || req.costImpact === null
          ? {}
          : { costImpact: { ...req.costImpact } }),
        expiresAt: req.expiresAt ?? null,
      },
    });
    await this.audit.write(tx, {
      actor: req.actor,
      action: 'APPROVAL_REQUESTED',
      subjectType: 'APPROVAL',
      subjectId: row.id,
      businessIds: [req.businessId, ...req.visibleTo],
      summary: `${req.title} — waiting for ${req.requestedFrom === 'OWNER' ? 'the owner' : 'a person at the client'}`,
      details: { type: req.type, subject: { type: req.subjectType, id: req.subjectId } },
    });
    return row;
  }

  /**
   * Decides a pending approval for the session's business. Runs the registered handler in the
   * same transaction, so the decision and its effect commit together.
   */
  async decide(input: {
    approvalId: string;
    businessId: string;
    decision: Extract<ApprovalDecision, 'APPROVED' | 'REJECTED'>;
    note?: string | undefined;
    actor: Actor;
  }): Promise<Approval> {
    const outcome = await this.db.$transaction(
      async (tx): Promise<{ expired: true } | { expired: false; approval: Approval }> => {
        const current = await tx.approval.findUnique({ where: { id: input.approvalId } });
        if (current === null) throw notFound('Approval');
        if (current.businessId !== input.businessId) {
          throw forbidden('This approval is addressed to another business');
        }
        if (current.decision !== 'PENDING') {
          throw conflict(`Approval already ${current.decision.toLowerCase()}`);
        }
        const now = this.now();
        if (current.expiresAt !== null && current.expiresAt.getTime() <= now.getTime()) {
          // Saved, then reported after the transaction commits.
          await tx.approval.update({
            where: { id: current.id },
            data: { decision: 'EXPIRED', decidedAt: now, decidedBy: 'SYSTEM' },
          });
          return { expired: true };
        }
        const updated = await tx.approval.updateMany({
          where: { id: current.id, decision: 'PENDING' },
          data: {
            decision: input.decision,
            decidedAt: now,
            decidedBy: input.actor,
            decisionNote: input.note ?? null,
          },
        });
        if (updated.count !== 1) throw conflict('Approval was decided concurrently');
        const decided = await tx.approval.findUniqueOrThrow({ where: { id: current.id } });
        await this.audit.write(tx, {
          actor: input.actor,
          action: 'APPROVAL_DECIDED',
          subjectType: 'APPROVAL',
          subjectId: decided.id,
          businessIds: [decided.businessId, ...(await this.visibleTo(tx, decided))],
          summary: `${decided.title}: ${input.decision.toLowerCase()}`,
          details: { type: decided.type, note: input.note ?? null },
        });
        const handler = this.handlers.get(decided.type);
        if (handler !== undefined) await handler(tx, decided);
        return { expired: false, approval: decided };
      },
      { isolationLevel: 'Serializable' },
    );
    if (outcome.expired) throw new AppError('CONFLICT', 'Approval expired');
    return outcome.approval;
  }

  /** Withdraws a pending approval (e.g. the goal was met while it waited). */
  async withdraw(tx: DbOrTx, approvalId: string, reason: string): Promise<void> {
    const res = await tx.approval.updateMany({
      where: { id: approvalId, decision: 'PENDING' },
      data: {
        decision: 'WITHDRAWN',
        decidedAt: this.now(),
        decidedBy: 'SYSTEM',
        decisionNote: reason,
      },
    });
    if (res.count === 1) {
      const row = await tx.approval.findUniqueOrThrow({ where: { id: approvalId } });
      await this.audit.write(tx, {
        actor: 'SYSTEM',
        action: 'APPROVAL_DECIDED',
        subjectType: 'APPROVAL',
        subjectId: approvalId,
        businessIds: [row.businessId, ...(await this.visibleTo(tx, row))],
        summary: `${row.title}: withdrawn (${reason})`,
      });
    }
  }

  /** Marks pending approvals past their expiry as EXPIRED. Returns how many changed. */
  async expireDue(): Promise<number> {
    const res = await this.db.approval.updateMany({
      where: { decision: 'PENDING', expiresAt: { lte: this.now() } },
      data: { decision: 'EXPIRED', decidedAt: this.now(), decidedBy: 'SYSTEM' },
    });
    return res.count;
  }

  async list(
    db: DbOrTx,
    businessId: string,
    filter: { decision?: ApprovalDecision | undefined; type?: ApprovalType | undefined },
  ): Promise<ApprovalView[]> {
    const rows = await db.approval.findMany({
      where: {
        businessId,
        ...(filter.decision === undefined ? {} : { decision: filter.decision }),
        ...(filter.type === undefined ? {} : { type: filter.type }),
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toApprovalView);
  }

  /** The other party on a deal approval, so both sides see it in their audit trail. */
  private async visibleTo(tx: DbOrTx, approval: Approval): Promise<string[]> {
    if (approval.dealId === null) return [];
    const deal = await tx.deal.findUnique({
      where: { id: approval.dealId },
      select: { clientId: true, plan: { select: { goal: { select: { supplierId: true } } } } },
    });
    return deal === null ? [] : [deal.clientId, deal.plan.goal.supplierId];
  }
}
