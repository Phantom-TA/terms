/**
 * The negotiation engine (CONTEXT.md, "Negotiation protocol and policies"): structured messages
 * between the supplier agent and a client agent, stored before they are delivered, at most three
 * rounds, every offer with an expiry. Movers decide which allowed move to make (deterministic
 * strategies now, LLM negotiators later); this engine decides what is allowed:
 *  - every move is checked against both parties' policies before it takes effect (guard*);
 *  - a move over the plan's cost ceiling becomes NEEDS_OWNER and waits for the owner;
 *  - an agreement whose payment is above the client's auto-pay limit asks the client's person.
 * Nothing here touches PayPal: an AGREED deal is executed by the invoice and payment services.
 */
import {
  addDays,
  bpsToPercent,
  type DealState,
  discountOn,
  formatMoney,
  fromCents,
  impliedAnnualRate,
  isBlocked,
  isoDateInTimeZone,
  MAX_NEGOTIATION_ROUNDS,
  type MessageType,
  NegotiationTerms,
  paymentFor,
  percentToBps,
  type PolicyCheck,
  toCents,
  type Actor,
} from '@terms/shared';
import { type ApprovalService } from '../approvals/approval-service.js';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx } from '../db.js';
import { type DealStore, termsJson } from '../deals/deal-store.js';
import { AppError, conflict, notFound, policyBlocked } from '../errors.js';
import { type Approval, type Deal } from '../generated/prisma/client.js';
import { dateToIso } from '../mappers.js';
import { deterministicMovers, type Movers } from './simulator.js';
import {
  type ClientMove,
  type ClientView,
  clientChecks,
  daysEarlyOf,
  type SupplierMove,
  type SupplierView,
  supplierChecks,
  type Terms,
} from './strategies.js';

/** How long an offer or counter stays open. */
export const OFFER_TTL_MS = 48 * 60 * 60 * 1000;

const CLOSED: readonly DealState[] = ['DECLINED', 'EXPIRED', 'WITHDRAWN', 'FAILED', 'REMOVED'];

export function termsToWire(t: Terms): NegotiationTerms {
  return {
    amountEarly: fromCents(t.amountEarly),
    discountPct: bpsToPercent(t.discountBps),
    payBy: t.payBy,
    remainderDue: t.remainderDue,
  };
}

export function wireToTerms(w: NegotiationTerms): Terms {
  return {
    amountEarly: toCents(w.amountEarly),
    discountBps: percentToBps(w.discountPct),
    payBy: w.payBy,
    remainderDue: w.remainderDue,
  };
}

const sameTerms = (a: Terms, b: Terms): boolean =>
  a.amountEarly === b.amountEarly &&
  a.discountBps === b.discountBps &&
  a.payBy === b.payBy &&
  a.remainderDue === b.remainderDue;

const dealInclude = {
  invoice: true,
  client: { include: { clientPolicy: true } },
  planItem: true,
  plan: {
    include: {
      goal: { include: { supplier: { include: { supplierPolicy: true } } } },
      deals: { select: { id: true, state: true, action: true, costCents: true } },
    },
  },
} as const;

type Ctx = Awaited<ReturnType<NegotiationEngine['load']>>;

export class NegotiationEngine {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly deals: DealStore,
    private readonly approvals: ApprovalService,
    private readonly now: () => Date = () => new Date(),
    private readonly movers: Movers = deterministicMovers,
  ) {
    approvals.onDecision('COUNTER_OVER_PLAN', (tx, approval) => this.onOwnerDecision(tx, approval));
  }

  async load(db: DbOrTx, dealId: string) {
    const deal = await db.deal.findUnique({ where: { id: dealId }, include: dealInclude });
    if (deal === null) throw notFound('Deal');
    const goal = deal.plan.goal;
    const supplier = goal.supplier;
    const today = isoDateInTimeZone(this.now(), supplier.timeZone);
    const otherRowsCost = deal.plan.deals
      .filter((d) => d.id !== deal.id && d.action !== 'REMINDER' && !CLOSED.includes(d.state))
      .reduce((sum, d) => sum + d.costCents, 0n);
    const supplierView: SupplierView = {
      clientId: deal.clientId,
      doNotContact: [...goal.doNotContactIds, ...(supplier.supplierPolicy?.doNotContact ?? [])],
      maxBps: goal.maxDiscountBps,
      planBps: deal.planItem.discountBps ?? goal.openingDiscountBps,
      ceiling: deal.plan.costCeilingCents,
      otherRowsCost,
      invoiceDue: deal.invoice.amountDueCents,
      dueDate: dateToIso(deal.invoice.dueDate),
      today,
    };
    const policy = deal.client.clientPolicy;
    const clientView: ClientView | null =
      policy === null
        ? null
        : {
            supplierId: supplier.id,
            invoiceDue: deal.invoice.amountDueCents,
            dueDate: dateToIso(deal.invoice.dueDate),
            cashAvailable: policy.cashOnHandCents,
            policy: {
              hurdleBps: policy.hurdleBps,
              targetBps: policy.targetBps,
              cashBuffer: policy.cashBufferCents,
              autoPayLimit: policy.autoPayLimitCents,
              earlyPayCap: policy.earlyPayCapCents,
              neverPayEarly: policy.neverPayEarly,
            },
          };
    const current = NegotiationTerms.safeParse(deal.currentTerms);
    return {
      deal,
      supplier,
      today,
      supplierView,
      clientView,
      current: current.success ? wireToTerms(current.data) : null,
      parties: { supplier: `supplier:${supplier.slug}`, client: `client:${deal.client.slug}` },
      businessIds: [supplier.id, deal.clientId],
    };
  }

  // ------------------------------------------------------------------ messages

  private async message(
    tx: DbOrTx,
    ctx: Ctx,
    m: {
      from: 'supplier' | 'client';
      actor: Actor;
      type: MessageType;
      terms: Terms | null;
      round: number;
      note: string;
      checks: readonly PolicyCheck[];
      expiresAt: Date | null;
    },
  ): Promise<void> {
    const dueDate = dateToIso(ctx.deal.invoice.dueDate);
    const days = m.terms === null ? 0 : daysEarlyOf(m.terms, dueDate);
    await tx.negotiationMessage.create({
      data: {
        dealId: ctx.deal.id,
        fromParty: m.from === 'supplier' ? ctx.parties.supplier : ctx.parties.client,
        toParty: m.from === 'supplier' ? ctx.parties.client : ctx.parties.supplier,
        actor: m.actor,
        type: m.type,
        terms: termsJson(m.terms === null ? null : termsToWire(m.terms)),
        impliedAnnualRate:
          m.terms !== null && days >= 1 ? impliedAnnualRate(m.terms.discountBps, days) : null,
        payNowCents: m.terms === null ? null : paymentFor(m.terms.amountEarly, m.terms.discountBps),
        note: m.note,
        policyChecks: m.checks.map((c) => ({ ...c })),
        round: m.round,
        expiresAt: m.expiresAt,
      },
    });
    await this.audit.write(tx, {
      actor: m.actor,
      action: 'NEGOTIATION_MESSAGE',
      subjectType: 'DEAL',
      subjectId: ctx.deal.id,
      businessIds: ctx.businessIds,
      summary: `${m.type} round ${String(m.round)}: ${m.note}`,
      details: {
        type: m.type,
        round: m.round,
        terms: m.terms === null ? null : termsToWire(m.terms),
        policyChecks: m.checks,
      },
    });
  }

  private note(type: MessageType, terms: Terms | null, ctx: Ctx, reason?: string): string {
    const inv = `invoice ${ctx.deal.invoice.number}`;
    if (terms === null) return reason === undefined ? `${type} on ${inv}` : `${reason}.`;
    const pay = formatMoney(paymentFor(terms.amountEarly, terms.discountBps));
    const what = `${pay} by ${terms.payBy} against ${formatMoney(terms.amountEarly)} of ${inv} (${bpsToPercent(terms.discountBps)}% off)`;
    const tail = reason === undefined || reason === '' ? '' : ` ${reason}.`;
    switch (type) {
      case 'OFFER':
        return `Offer: ${what}.${tail}`;
      case 'COUNTER':
        return `Counter: ${what}.${tail}`;
      case 'ACCEPT':
        return `Accepted: ${what}.`;
      default:
        return `${type}: ${what}.${tail}`;
    }
  }

  // ------------------------------------------------------------------ the opening offer

  /** Sends the plan's offer for an APPROVED offer deal (round 1). */
  async sendOffer(dealId: string): Promise<Deal> {
    return this.db.$transaction(async (tx) => {
      const ctx = await this.load(tx, dealId);
      const { deal } = ctx;
      if (deal.state !== 'APPROVED') throw conflict(`Deal is ${deal.state}, not APPROVED`);
      if (deal.action === 'REMINDER' || deal.action === 'NONE')
        throw conflict('This deal sends no offer');
      const amount = deal.planItem.amountEarlyCents;
      const bps = deal.planItem.discountBps;
      if (amount === null || bps === null) throw conflict('The plan row has no offer terms');
      const terms: Terms = {
        amountEarly: amount,
        discountBps: bps,
        payBy: ctx.today,
        remainderDue: amount < ctx.supplierView.invoiceDue ? ctx.supplierView.dueDate : null,
      };
      const checks = supplierChecks(ctx.supplierView, terms, 1);
      // The plan was approved within its ceiling; any block means the world changed since.
      if (isBlocked(checks) || checks.some((c) => c.result === 'needs_approval')) {
        throw policyBlocked('The plan offer no longer passes policy', checks);
      }
      const expiresAt = new Date(this.now().getTime() + OFFER_TTL_MS);
      await this.message(tx, ctx, {
        from: 'supplier',
        actor: 'SUPPLIER_AGENT',
        type: 'OFFER',
        terms,
        round: 1,
        note: this.note('OFFER', terms, ctx),
        checks,
        expiresAt,
      });
      return this.deals.transition(
        {
          dealId,
          to: 'SENT',
          actor: 'SUPPLIER_AGENT',
          reason: `Offer sent: ${bpsToPercent(terms.discountBps)}% on ${formatMoney(terms.amountEarly)}`,
          patch: { currentTerms: termsToWire(terms), round: 1, expiresAt },
        },
        tx,
      );
    });
  }

  // ------------------------------------------------------------------ client agent

  /** Checks a client move against the client's own policy before it takes effect. */
  guardClientMove(view: ClientView, offer: Terms, round: number, move: ClientMove): void {
    if (move.type === 'DECLINE') return;
    if (move.type === 'ACCEPT') {
      if (!sameTerms(move.terms, offer))
        throw policyBlocked('An accept must accept the offer as made', []);
      const checks = clientChecks(view, offer, round);
      if (isBlocked(checks)) throw policyBlocked('Accepting breaks the client policy', checks);
      return;
    }
    const checks = clientChecks(view, move.terms, round + 1);
    if (
      isBlocked(checks) ||
      move.terms.amountEarly > view.invoiceDue ||
      move.terms.amountEarly <= 0n
    ) {
      throw policyBlocked('The counter breaks the client policy', checks);
    }
  }

  /** The client agent answers the open offer. */
  async clientTurn(dealId: string): Promise<Deal> {
    return this.db.$transaction(
      async (tx) => {
        const ctx = await this.load(tx, dealId);
        const { deal, current, clientView } = ctx;
        if (deal.state !== 'SENT' || current === null)
          throw conflict(`No open offer on deal (${deal.state})`);
        if (clientView === null || !deal.client.hasAgent)
          throw conflict(`${deal.client.name} has no agent`);
        if (deal.expiresAt !== null && deal.expiresAt.getTime() <= this.now().getTime()) {
          return this.deals.transition(
            { dealId, to: 'EXPIRED', actor: 'SYSTEM', reason: 'The offer expired' },
            tx,
          );
        }
        const move = this.movers.client(clientView, current, deal.round);
        this.guardClientMove(clientView, current, deal.round, move);
        if (move.type === 'ACCEPT')
          return this.agree(tx, ctx, current, 'client', 'CLIENT_AGENT', deal.round, move.checks);
        if (move.type === 'DECLINE') {
          await this.message(tx, ctx, {
            from: 'client',
            actor: 'CLIENT_AGENT',
            type: 'DECLINE',
            terms: null,
            round: deal.round,
            note: this.note('DECLINE', null, ctx, move.reason),
            checks: move.checks,
            expiresAt: null,
          });
          return this.deals.transition(
            {
              dealId,
              to: 'DECLINED',
              actor: 'CLIENT_AGENT',
              reason: move.reason,
              patch: { closedReason: move.reason },
            },
            tx,
          );
        }
        const round = deal.round + 1;
        const expiresAt = new Date(this.now().getTime() + OFFER_TTL_MS);
        await this.message(tx, ctx, {
          from: 'client',
          actor: 'CLIENT_AGENT',
          type: 'COUNTER',
          terms: move.terms,
          round,
          note: this.note('COUNTER', move.terms, ctx, move.reason),
          checks: move.checks,
          expiresAt,
        });
        return this.deals.transition(
          {
            dealId,
            to: 'COUNTERED',
            actor: 'CLIENT_AGENT',
            reason: move.reason,
            patch: { currentTerms: termsToWire(move.terms), round, expiresAt },
          },
          tx,
        );
      },
      { isolationLevel: 'Serializable' },
    );
  }

  // ------------------------------------------------------------------ supplier agent

  /** Checks a supplier move against the owner's policy before it takes effect. */
  guardSupplierMove(view: SupplierView, counter: Terms, round: number, move: SupplierMove): void {
    if (move.type === 'DECLINE') return;
    const moveRound =
      move.type === 'COUNTER' || (move.type === 'NEEDS_OWNER' && move.onApproval === 'COUNTER')
        ? round + 1
        : round;
    const checks = supplierChecks(view, move.terms, moveRound);
    if (isBlocked(checks)) throw policyBlocked('The move breaks the owner policy', checks);
    const ceiling = checks.find((c) => c.rule === 'costCeiling');
    if (move.type === 'NEEDS_OWNER') {
      if (ceiling?.result !== 'needs_approval')
        throw policyBlocked('Only a move over the ceiling needs the owner', checks);
      return;
    }
    if (ceiling?.result !== 'pass')
      throw policyBlocked('Over the cost ceiling without the owner', checks);
    if (move.type === 'ACCEPT' && !sameTerms(move.terms, counter)) {
      throw policyBlocked('An accept must accept the counter as made', checks);
    }
  }

  /** The supplier agent answers the client's counter. */
  async supplierTurn(dealId: string): Promise<Deal> {
    return this.db.$transaction(
      async (tx) => {
        const ctx = await this.load(tx, dealId);
        const { deal, current } = ctx;
        if (deal.state !== 'COUNTERED' || current === null)
          throw conflict(`No counter to answer (${deal.state})`);
        const move = this.movers.supplier(ctx.supplierView, current, deal.round);
        this.guardSupplierMove(ctx.supplierView, current, deal.round, move);
        switch (move.type) {
          case 'ACCEPT':
            return this.agree(
              tx,
              ctx,
              move.terms,
              'supplier',
              'SUPPLIER_AGENT',
              deal.round,
              move.checks,
            );
          case 'COUNTER':
            return this.counterFromSupplier(
              tx,
              ctx,
              move.terms,
              'SUPPLIER_AGENT',
              move.reason,
              move.checks,
            );
          case 'DECLINE':
            return this.declineFromSupplier(tx, ctx, 'SUPPLIER_AGENT', move.reason, move.checks);
          case 'NEEDS_OWNER':
            return this.askOwner(tx, ctx, move);
        }
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async counterFromSupplier(
    tx: DbOrTx,
    ctx: Ctx,
    terms: Terms,
    actor: Actor,
    reason: string,
    checks: readonly PolicyCheck[],
  ): Promise<Deal> {
    const round = ctx.deal.round + 1;
    const expiresAt = new Date(this.now().getTime() + OFFER_TTL_MS);
    await this.message(tx, ctx, {
      from: 'supplier',
      actor,
      type: 'COUNTER',
      terms,
      round,
      note: this.note('COUNTER', terms, ctx, reason),
      checks,
      expiresAt,
    });
    return this.deals.transition(
      {
        dealId: ctx.deal.id,
        to: 'SENT',
        actor,
        reason,
        patch: { currentTerms: termsToWire(terms), round, expiresAt },
      },
      tx,
    );
  }

  private async declineFromSupplier(
    tx: DbOrTx,
    ctx: Ctx,
    actor: Actor,
    reason: string,
    checks: readonly PolicyCheck[],
  ): Promise<Deal> {
    await this.message(tx, ctx, {
      from: 'supplier',
      actor,
      type: 'DECLINE',
      terms: null,
      round: ctx.deal.round,
      note: this.note('DECLINE', null, ctx, reason),
      checks,
      expiresAt: null,
    });
    return this.deals.transition(
      { dealId: ctx.deal.id, to: 'DECLINED', actor, reason, patch: { closedReason: reason } },
      tx,
    );
  }

  private async askOwner(
    tx: DbOrTx,
    ctx: Ctx,
    move: Extract<SupplierMove, { type: 'NEEDS_OWNER' }>,
  ): Promise<Deal> {
    const { deal } = ctx;
    const before = ctx.supplierView.otherRowsCost + deal.costCents;
    const after =
      ctx.supplierView.otherRowsCost + discountOn(move.terms.amountEarly, move.terms.discountBps);
    const deal2 = await this.deals.transition(
      { dealId: deal.id, to: 'NEEDS_OWNER', actor: 'SUPPLIER_AGENT', reason: move.reason },
      tx,
    );
    await this.approvals.request(tx, {
      type: 'COUNTER_OVER_PLAN',
      subjectType: 'DEAL',
      subjectId: deal.id,
      requestedFrom: 'OWNER',
      businessId: ctx.supplier.id,
      visibleTo: [deal.clientId],
      title: `${move.onApproval === 'COUNTER' ? 'Counter' : 'Accept'} ${deal.client.name} at ${bpsToPercent(move.terms.discountBps)}%`,
      summary: `${move.reason}.`,
      planId: deal.planId,
      dealId: deal.id,
      terms: termsToWire(move.terms),
      costImpact: {
        planCostBefore: fromCents(before),
        planCostAfter: fromCents(after),
        delta: fromCents(after - before),
        ceiling: fromCents(ctx.supplierView.ceiling),
        overCeilingBy: fromCents(move.overCeilingBy),
      },
      expiresAt: deal.expiresAt,
      actor: 'SUPPLIER_AGENT',
    });
    return deal2;
  }

  /** The owner decided a NEEDS_OWNER request (runs inside the approval's transaction). */
  private async onOwnerDecision(tx: DbOrTx, approval: Approval): Promise<void> {
    if (approval.dealId === null) return;
    const ctx = await this.load(tx, approval.dealId);
    if (ctx.deal.state !== 'NEEDS_OWNER' || ctx.current === null)
      throw conflict('Deal is no longer waiting for the owner');
    const prepared = NegotiationTerms.safeParse(approval.terms);
    if (!prepared.success) throw conflict('The approval carries no terms');
    const terms = wireToTerms(prepared.data);
    if (approval.decision !== 'APPROVED') {
      await this.declineFromSupplier(
        tx,
        ctx,
        'OWNER',
        'The owner declined to go over the plan',
        [],
      );
      return;
    }
    const accepting = sameTerms(terms, ctx.current);
    // Hard limits still apply after the owner's yes; only the ceiling was the owner's to waive.
    const checks = supplierChecks(
      ctx.supplierView,
      terms,
      accepting ? ctx.deal.round : ctx.deal.round + 1,
    );
    if (isBlocked(checks)) throw policyBlocked('The prepared move now breaks policy', checks);
    if (accepting) {
      await this.agree(tx, ctx, terms, 'supplier', 'OWNER', ctx.deal.round, checks);
    } else {
      await this.counterFromSupplier(
        tx,
        ctx,
        terms,
        'OWNER',
        'Approved by the owner over the plan ceiling',
        checks,
      );
    }
  }

  // ------------------------------------------------------------------ agreement

  private async agree(
    tx: DbOrTx,
    ctx: Ctx,
    terms: Terms,
    from: 'supplier' | 'client',
    actor: Actor,
    round: number,
    checks: readonly PolicyCheck[],
  ): Promise<Deal> {
    const { deal } = ctx;
    const cost = discountOn(terms.amountEarly, terms.discountBps);
    const payment = terms.amountEarly - cost;
    await this.message(tx, ctx, {
      from,
      actor,
      type: 'ACCEPT',
      terms,
      round,
      note: this.note('ACCEPT', terms, ctx),
      checks,
      expiresAt: null,
    });
    const agreed = await this.deals.transition(
      {
        dealId: deal.id,
        to: 'AGREED',
        actor,
        reason: `Agreed ${bpsToPercent(terms.discountBps)}% on ${formatMoney(terms.amountEarly)}: ${formatMoney(payment)} committed for ${formatMoney(cost)}`,
        patch: {
          agreedTerms: termsToWire(terms),
          currentTerms: termsToWire(terms),
          costCents: cost,
          committedCents: payment,
          expiresAt: null,
        },
      },
      tx,
    );
    // Whoever accepted, a payment above the client's auto-pay limit needs its person (I-4).
    const limit = ctx.clientView?.policy.autoPayLimit ?? null;
    if (limit !== null && payment > limit) {
      await this.approvals.request(tx, {
        type: 'CLIENT_PAYMENT',
        subjectType: 'DEAL',
        subjectId: deal.id,
        requestedFrom: 'CLIENT_HUMAN',
        businessId: deal.clientId,
        visibleTo: [ctx.supplier.id],
        title: `Approve ${formatMoney(payment)} to ${ctx.supplier.name}`,
        summary: `${formatMoney(payment)} is above your ${formatMoney(limit)} auto-pay limit: invoice ${deal.invoice.number}, ${bpsToPercent(terms.discountBps)}% off ${formatMoney(terms.amountEarly)}.`,
        dealId: deal.id,
        terms: termsToWire(terms),
        paymentAmountCents: payment,
        expiresAt: new Date(`${addDays(terms.payBy, 1)}T00:00:00Z`),
        actor: 'CLIENT_AGENT',
      });
    }
    return agreed;
  }

  // ------------------------------------------------------------------ orchestration

  /** Lets both agents move until the deal waits for something else (owner, person, PayPal). */
  async runAgents(dealId: string): Promise<Deal> {
    for (let step = 0; step < 2 * MAX_NEGOTIATION_ROUNDS + 2; step++) {
      const deal = await this.deals.get(this.db, dealId);
      if (deal.state === 'APPROVED' && deal.action === 'NEGOTIATE') await this.sendOffer(dealId);
      else if (deal.state === 'SENT') {
        const client = await this.db.business.findUniqueOrThrow({ where: { id: deal.clientId } });
        if (!client.hasAgent) return deal; // a person answers on the offer page
        await this.clientTurn(dealId);
      } else if (deal.state === 'COUNTERED') await this.supplierTurn(dealId);
      else return deal;
    }
    throw new AppError('INTERNAL', `Negotiation on deal ${dealId} did not settle`);
  }

  /** Closes offers past their expiry. Returns how many expired. */
  async expireDue(): Promise<number> {
    const due = await this.db.deal.findMany({
      where: { state: { in: ['SENT', 'COUNTERED'] }, expiresAt: { lte: this.now() } },
      select: { id: true },
    });
    for (const d of due) {
      await this.deals.transition({
        dealId: d.id,
        to: 'EXPIRED',
        actor: 'SYSTEM',
        reason: 'The offer expired',
      });
    }
    return due.length;
  }
}
