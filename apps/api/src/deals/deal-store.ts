/**
 * Persists deal state changes. Every transition is checked against the shared state machine
 * (including who may make it), applied with an optimistic lock, recorded in the deal's history,
 * and written to the audit trail in the same database transaction.
 */
import {
  type Actor,
  assertTransition,
  type DealState,
  isCommitted,
  type NegotiationTerms,
} from '@terms/shared';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { type Deal, Prisma } from '../generated/prisma/client.js';

export interface TransitionRequest {
  dealId: string;
  to: DealState;
  actor: Actor;
  /** Plain-language reason stored in the history and the audit trail. */
  reason: string;
  /** Expected version (optimistic lock). Omit to use the version just read. */
  expectedVersion?: number;
  /** Field updates applied atomically with the state change. */
  patch?: DealPatch;
  /** Extra audit details (policy checks, PayPal IDs). */
  details?: Record<string, unknown>;
  paypalDebugId?: string | null;
  paypalRequestId?: string | null;
  /** The PayPal call behind this transition, e.g. "PUT /v2/invoicing/invoices/{id}". */
  paypalCall?: string | null;
}

export interface DealPatch {
  currentTerms?: NegotiationTerms | null;
  agreedTerms?: NegotiationTerms | null;
  round?: number;
  costCents?: bigint;
  committedCents?: bigint;
  expiresAt?: Date | null;
  closedReason?: string | null;
  reissuedInvoiceId?: string | null;
  paypalOrderId?: string | null;
  paypalCaptureId?: string | null;
  invoicePaymentId?: string | null;
  payerUrl?: string | null;
}

/** Notified after a transition commits (used for live updates). */
export type DealListener = (deal: Deal, from: DealState) => void;

const FINAL_REASON_STATES: readonly DealState[] = ['DECLINED', 'EXPIRED', 'WITHDRAWN', 'FAILED'];

/** NegotiationTerms as a JSON column value; null clears the column. */
export function termsJson(
  terms: NegotiationTerms | null,
): Prisma.InputJsonObject | typeof Prisma.DbNull {
  return terms === null ? Prisma.DbNull : { ...terms };
}

function patchData(patch: DealPatch): Prisma.DealUpdateManyMutationInput {
  const data: Prisma.DealUpdateManyMutationInput = {};
  if (patch.currentTerms !== undefined) data.currentTerms = termsJson(patch.currentTerms);
  if (patch.agreedTerms !== undefined) data.agreedTerms = termsJson(patch.agreedTerms);
  if (patch.round !== undefined) data.round = patch.round;
  if (patch.costCents !== undefined) data.costCents = patch.costCents;
  if (patch.committedCents !== undefined) data.committedCents = patch.committedCents;
  if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
  if (patch.closedReason !== undefined) data.closedReason = patch.closedReason;
  if (patch.reissuedInvoiceId !== undefined) data.reissuedInvoiceId = patch.reissuedInvoiceId;
  if (patch.paypalOrderId !== undefined) data.paypalOrderId = patch.paypalOrderId;
  if (patch.paypalCaptureId !== undefined) data.paypalCaptureId = patch.paypalCaptureId;
  if (patch.invoicePaymentId !== undefined) data.invoicePaymentId = patch.invoicePaymentId;
  if (patch.payerUrl !== undefined) data.payerUrl = patch.payerUrl;
  return data;
}

export class DealStore {
  private readonly listeners = new Set<DealListener>();

  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
  ) {}

  onTransition(listener: DealListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async get(db: DbOrTx, dealId: string): Promise<Deal> {
    const deal = await db.deal.findUnique({ where: { id: dealId } });
    if (deal === null) throw notFound('Deal');
    return deal;
  }

  /**
   * Moves a deal to a new state in its own transaction (or inside `tx` when given).
   * Throws IllegalTransitionError for a move the state machine or the actor rules forbid, and
   * CONFLICT when another writer changed the deal first.
   */
  async transition(req: TransitionRequest, tx?: DbOrTx): Promise<Deal> {
    const run = async (db: DbOrTx): Promise<{ deal: Deal; from: DealState }> => {
      const current = await this.get(db, req.dealId);
      const from = current.state;
      assertTransition(from, req.to, req.actor);
      const version = req.expectedVersion ?? current.version;
      if (version !== current.version) {
        throw conflict(
          `Deal ${req.dealId} changed (version ${current.version}, expected ${version})`,
        );
      }
      const data: Prisma.DealUpdateManyMutationInput = {
        ...patchData(req.patch ?? {}),
        state: req.to,
        version: { increment: 1 },
      };
      if (FINAL_REASON_STATES.includes(req.to) && req.patch?.closedReason === undefined) {
        data.closedReason = req.reason;
      }
      const updated = await db.deal.updateMany({
        where: { id: req.dealId, version },
        data,
      });
      if (updated.count !== 1) throw conflict(`Deal ${req.dealId} was changed by another writer`);

      await db.dealTransition.create({
        data: {
          dealId: req.dealId,
          fromState: from,
          toState: req.to,
          actor: req.actor,
          reason: req.reason,
        },
      });
      const plan = await db.plan.findUniqueOrThrow({
        where: { id: current.planId },
        select: { goal: { select: { supplierId: true } } },
      });
      await this.audit.write(db, {
        actor: req.actor,
        action: 'DEAL_TRANSITION',
        subjectType: 'DEAL',
        subjectId: req.dealId,
        businessIds: [plan.goal.supplierId, current.clientId],
        summary: `${from} → ${req.to}: ${req.reason}`,
        details: { from, to: req.to, ...(req.details ?? {}) },
        paypalDebugId: req.paypalDebugId ?? null,
        paypalRequestId: req.paypalRequestId ?? null,
        paypalCall: req.paypalCall ?? null,
      });
      return { deal: await this.get(db, req.dealId), from };
    };

    const result =
      tx === undefined
        ? await this.db.$transaction((t) => run(t), { isolationLevel: 'Serializable' })
        : await run(tx);
    if (tx === undefined) {
      for (const listener of this.listeners) listener(result.deal, result.from);
    }
    return result.deal;
  }

  /**
   * Cash committed by a plan's deals: deals that are AGREED or later, never reminders. A deal that
   * EXPIRES or FAILS after agreeing stops counting because its state leaves the committed set.
   */
  async committedForPlan(db: DbOrTx, planId: string): Promise<{ committed: bigint; cost: bigint }> {
    const deals = await db.deal.findMany({
      where: { planId, action: { not: 'REMINDER' } },
      select: { state: true, committedCents: true, costCents: true },
    });
    let committed = 0n;
    let cost = 0n;
    for (const d of deals) {
      if (isCommitted(d.state)) {
        committed += d.committedCents;
        cost += d.costCents;
      }
    }
    return { committed, cost };
  }
}
