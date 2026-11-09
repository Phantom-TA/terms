/**
 * PayPal Invoicing for the deal engine (paypal-plan.md: Durable writes, Unknown outcomes, I-3):
 *  - applyTerms: the agreed discount and partial-payment minimum go onto the SENT invoice with a
 *    full update (spike S1), then the deal moves AGREED → INVOICE_UPDATED → AWAITING_PAYMENT;
 *  - remind: a reminder for an APPROVED reminder deal, which then counts as SENT;
 *  - recordPayment: links an agent's PayPal capture to the invoice (spike S2).
 * Every write is claimed in the ledger first and carries the claim's PayPal-Request-Id. A write
 * whose outcome is unknown is settled by re-reading the invoice, never reported as failed.
 * Nothing here marks a deal PAID: only a verified webhook or a server read does (settlement).
 */
import {
  checkDoNotContact,
  discountOn,
  formatMoney,
  fromCents,
  NegotiationTerms,
  percentToBps,
  toCents,
} from '@terms/shared';
import { z } from 'zod';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx } from '../db.js';
import { type DealStore } from '../deals/deal-store.js';
import { conflict, notFound, policyBlocked } from '../errors.js';
import { type Deal, type PayPalWrite } from '../generated/prisma/client.js';
import { classify, mayHaveTakenEffect, type PayPalFailure, toAppError } from './errors.js';
import { figuresOf, mirroredStatus, WireInvoice } from './invoice-wire.js';
import { type PayPalRestClient } from './rest-client.js';
import { type WriteLedger } from './write-ledger.js';

export const INVOICE_CALLS = {
  read: 'GET /v2/invoicing/invoices/{id}',
  update: 'PUT /v2/invoicing/invoices/{id}',
  remind: 'POST /v2/invoicing/invoices/{id}/remind',
  recordPayment: 'POST /v2/invoicing/invoices/{id}/payments',
} as const;

/** What a write achieved: applied now, or PayPal may have acted and Terms is still checking. */
export type WriteOutcome = 'applied' | 'unknown';

export interface InvoiceTerms {
  discountCents: bigint;
  /** Partial-payment minimum for a split deal; null when the whole invoice is paid early. */
  minimumCents: bigint | null;
}

/** The invoice terms an agreement implies (CONTEXT.md, "Actions and planner"). */
export function invoiceTermsFor(agreed: NegotiationTerms, amountDueCents: bigint): InvoiceTerms {
  const amountEarly = toCents(agreed.amountEarly);
  const discount = discountOn(amountEarly, percentToBps(agreed.discountPct));
  return {
    discountCents: discount,
    minimumCents: amountEarly < amountDueCents ? amountEarly - discount : null,
  };
}

/**
 * The full-update body: the invoice as PayPal holds it, with the agreed discount (written fresh as
 * a positive amount; it reads back negative) and the recomputed total, which PayPal checks against
 * the breakdown (`calculation_error` otherwise).
 */
export function updatedInvoiceBody(current: WireInvoice, terms: InvoiceTerms): WireInvoice {
  const figures = figuresOf(current);
  const amount = current.amount;
  if (amount === undefined) throw new Error(`Invoice ${current.id} has no amount`);
  const currency = amount.currency_code;
  const total = figures.totalCents + figures.discountCents - terms.discountCents;
  return {
    ...current,
    amount: {
      ...amount,
      value: fromCents(total),
      breakdown: {
        ...amount.breakdown,
        discount: {
          ...amount.breakdown?.discount,
          invoice_discount: {
            amount: { currency_code: currency, value: fromCents(terms.discountCents) },
          },
        },
      },
    },
    configuration: {
      ...current.configuration,
      partial_payment:
        terms.minimumCents === null
          ? { allow_partial_payment: false }
          : {
              allow_partial_payment: true,
              minimum_amount_due: { currency_code: currency, value: fromCents(terms.minimumCents) },
            },
    },
  };
}

/** Whether PayPal holds the agreed terms, e.g. after a write whose answer was lost. */
export function hasTerms(invoice: WireInvoice, terms: InvoiceTerms): boolean {
  const f = figuresOf(invoice);
  return f.discountCents === terms.discountCents && f.minimumCents === terms.minimumCents;
}

const invoicePath = (paypalInvoiceId: string): string =>
  `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}`;

const dealInclude = {
  invoice: true,
  client: true,
  plan: { include: { goal: true } },
} as const;

type DealContext = Awaited<ReturnType<InvoiceService['context']>>;

export class InvoiceService {
  constructor(
    private readonly db: Db,
    private readonly rest: PayPalRestClient,
    private readonly ledger: WriteLedger,
    private readonly audit: AuditLogger,
    private readonly deals: DealStore,
  ) {}

  /** Reads an invoice from PayPal (a server read, usable as settlement evidence). */
  async read(paypalInvoiceId: string, signal?: AbortSignal): Promise<WireInvoice> {
    try {
      const res = await this.rest.request({
        method: 'GET',
        path: invoicePath(paypalInvoiceId),
        schema: WireInvoice,
        ...(signal === undefined ? {} : { signal }),
      });
      return res.data;
    } catch (err) {
      throw toAppError(classify(err), 'invoice');
    }
  }

  /** Updates Terms' mirror of an invoice from PayPal's copy. */
  async mirror(db: DbOrTx, invoiceId: string, wire: WireInvoice): Promise<void> {
    const f = figuresOf(wire);
    const updated = wire.detail.metadata?.last_update_time;
    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        paypalStatus: mirroredStatus(wire.status),
        amountCents: f.totalCents,
        amountPaidCents: f.paidCents,
        amountDueCents: f.dueCents,
        paypalUrl: wire.detail.metadata?.recipient_view_url ?? null,
        ...(updated === undefined ? {} : { paypalUpdatedAt: new Date(updated) }),
        lastSyncedAt: new Date(),
      },
    });
  }

  private async context(dealId: string) {
    const deal = await this.db.deal.findUnique({ where: { id: dealId }, include: dealInclude });
    if (deal === null) throw notFound('Deal');
    const supplierId = deal.plan.goal.supplierId;
    // I-3: the invoice is the deal's own, issued by the deal's supplier.
    if (
      deal.invoice.supplierId !== supplierId ||
      deal.invoice.paypalInvoiceId !== deal.paypalInvoiceId
    ) {
      throw conflict(`Deal ${dealId} does not belong to invoice ${deal.paypalInvoiceId}`);
    }
    return { deal, supplierId, businessIds: [supplierId, deal.clientId] };
  }

  private async recordFailure(ctx: DealContext, call: string, f: PayPalFailure): Promise<void> {
    await this.audit.write(this.db, {
      actor: 'SYSTEM',
      action: 'PAYPAL_ERROR',
      subjectType: 'INVOICE',
      subjectId: ctx.deal.invoiceId,
      dealId: ctx.deal.id,
      businessIds: ctx.businessIds,
      summary: `PayPal ${f.kind === 'refused' ? 'refused' : 'failed'} ${call} for invoice ${ctx.deal.invoice.number}${f.reason === null ? '' : `: ${f.reason}`}`,
      details: { kind: f.kind, status: f.status, name: f.name },
      paypalCall: call,
      paypalDebugId: f.debugId,
    });
  }

  // ---------------------------------------------------------------- apply the agreed terms

  /**
   * Puts an AGREED deal's terms on its PayPal invoice and moves the deal to AWAITING_PAYMENT.
   * Safe to call again: a write already made is not repeated.
   */
  async applyTerms(dealId: string): Promise<{ deal: Deal; outcome: WriteOutcome }> {
    const ctx = await this.context(dealId);
    const { deal } = ctx;
    if (deal.state === 'INVOICE_UPDATED' || deal.state === 'AWAITING_PAYMENT') {
      return { deal, outcome: 'applied' };
    }
    if (deal.state !== 'AGREED') throw conflict(`Deal is ${deal.state}, not AGREED`);
    const agreed = NegotiationTerms.safeParse(deal.agreedTerms);
    if (!agreed.success) throw conflict('Deal has no agreed terms');
    const terms = invoiceTermsFor(agreed.data, deal.invoice.amountDueCents);

    const claim = await this.ledger.claim(this.db, {
      key: `invoice-update:${dealId}`,
      operation: 'invoicing.update',
      dealId,
    });
    if (claim.kind === 'existing') return this.settleTerms(ctx, claim.write, terms);

    let current: WireInvoice;
    try {
      current = (
        await this.rest.request({
          method: 'GET',
          path: invoicePath(deal.paypalInvoiceId),
          schema: WireInvoice,
        })
      ).data;
    } catch (err) {
      await this.ledger.release(this.db, claim.write.id); // nothing was written
      throw toAppError(classify(err), 'invoice');
    }

    try {
      const res = await this.rest.request({
        method: 'PUT',
        path: invoicePath(deal.paypalInvoiceId),
        query: { send_to_recipient: true, send_to_invoicer: false },
        body: updatedInvoiceBody(current, terms),
        requestId: claim.write.requestId,
        prefer: 'return=representation',
        schema: WireInvoice,
      });
      return {
        deal: await this.finishTerms(ctx, claim.write, res.data, terms, res.debugId),
        outcome: 'applied',
      };
    } catch (err) {
      const f = classify(err);
      if (mayHaveTakenEffect(f)) {
        await this.ledger.markUnknown(this.db, claim.write.id, {
          kind: f.kind,
          status: f.status,
          debugId: f.debugId,
        });
        return this.settleTerms(ctx, claim.write, terms);
      }
      await this.ledger.release(this.db, claim.write.id);
      await this.recordFailure(ctx, INVOICE_CALLS.update, f);
      if (f.kind === 'refused') {
        await this.deals.transition({
          dealId,
          to: 'FAILED',
          actor: 'SYSTEM',
          reason: `PayPal refused the invoice update: ${f.reason ?? f.name ?? String(f.status)}`,
          paypalCall: INVOICE_CALLS.update,
          paypalDebugId: f.debugId,
          patch: { closedReason: 'PayPal refused the invoice update' },
        });
      }
      throw toAppError(f, 'invoice');
    }
  }

  /** Re-reads the invoice to settle a terms write whose outcome is not known. */
  private async settleTerms(
    ctx: DealContext,
    write: PayPalWrite,
    terms: InvoiceTerms,
  ): Promise<{ deal: Deal; outcome: WriteOutcome }> {
    if (write.status === 'SUCCEEDED') {
      return { deal: await this.advanceAfterTerms(ctx, write, null), outcome: 'applied' };
    }
    let wire: WireInvoice;
    try {
      wire = await this.read(ctx.deal.paypalInvoiceId);
    } catch {
      return { deal: ctx.deal, outcome: 'unknown' }; // still unknown, never "failed"
    }
    if (hasTerms(wire, terms)) {
      return { deal: await this.finishTerms(ctx, write, wire, terms, null), outcome: 'applied' };
    }
    return { deal: ctx.deal, outcome: 'unknown' };
  }

  private async finishTerms(
    ctx: DealContext,
    write: PayPalWrite,
    wire: WireInvoice,
    terms: InvoiceTerms,
    debugId: string | null,
  ): Promise<Deal> {
    return this.db.$transaction(async (tx) => {
      await this.ledger.succeed(tx, write.id, wire.id);
      await this.mirror(tx, ctx.deal.invoiceId, wire);
      const f = figuresOf(wire);
      await this.audit.write(tx, {
        actor: 'SYSTEM',
        action: 'INVOICE_UPDATED',
        subjectType: 'INVOICE',
        subjectId: ctx.deal.invoiceId,
        dealId: ctx.deal.id,
        businessIds: ctx.businessIds,
        summary: `Invoice ${ctx.deal.invoice.number} updated: discount ${formatMoney(terms.discountCents)}, total ${formatMoney(f.totalCents)}${terms.minimumCents === null ? '' : `, minimum ${formatMoney(terms.minimumCents)}`}`,
        details: {
          paypalInvoiceId: wire.id,
          discount: terms.discountCents,
          minimum: terms.minimumCents,
          total: f.totalCents,
        },
        paypalCall: INVOICE_CALLS.update,
        paypalRequestId: write.requestId,
        paypalDebugId: debugId,
      });
      return this.advanceAfterTerms(
        ctx,
        write,
        wire.detail.metadata?.recipient_view_url ?? null,
        tx,
      );
    });
  }

  private async advanceAfterTerms(
    ctx: DealContext,
    write: PayPalWrite,
    payerUrl: string | null,
    tx?: DbOrTx,
  ): Promise<Deal> {
    const db = tx ?? this.db;
    let deal = await this.deals.get(db, ctx.deal.id);
    if (deal.state === 'AGREED') {
      deal = await this.deals.transition(
        {
          dealId: deal.id,
          to: 'INVOICE_UPDATED',
          actor: 'SYSTEM',
          reason: 'Agreed terms applied to the PayPal invoice',
          paypalCall: INVOICE_CALLS.update,
          paypalRequestId: write.requestId,
          ...(payerUrl === null ? {} : { patch: { payerUrl } }),
        },
        tx,
      );
    }
    if (deal.state === 'INVOICE_UPDATED') {
      deal = await this.deals.transition(
        {
          dealId: deal.id,
          to: 'AWAITING_PAYMENT',
          actor: 'SYSTEM',
          reason: 'Waiting for PayPal to confirm payment',
        },
        tx,
      );
    }
    return deal;
  }

  // ---------------------------------------------------------------- reminders

  /** Sends PayPal's reminder for an APPROVED reminder deal; the deal then counts as SENT. */
  async remind(dealId: string, note?: string): Promise<{ deal: Deal; outcome: WriteOutcome }> {
    const ctx = await this.context(dealId);
    const { deal } = ctx;
    if (deal.action !== 'REMINDER') throw conflict('Only a reminder deal sends a reminder');
    if (deal.state === 'SENT') return { deal, outcome: 'applied' };
    if (deal.state !== 'APPROVED') throw conflict(`Deal is ${deal.state}, not APPROVED`);
    // Policy is checked again at execution time, not only when planning.
    const policy = await this.db.supplierPolicy.findUnique({
      where: { businessId: ctx.supplierId },
    });
    const contact = checkDoNotContact(deal.clientId, [
      ...deal.plan.goal.doNotContactIds,
      ...(policy?.doNotContact ?? []),
    ]);
    if (contact.result !== 'pass')
      throw policyBlocked('This client is on the do-not-contact list', [contact]);

    const claim = await this.ledger.claim(this.db, {
      key: `invoice-remind:${dealId}`,
      operation: 'invoicing.remind',
      dealId,
    });
    if (claim.kind === 'existing') {
      // A reminder leaves no trace to re-read; an unknown one is never re-sent automatically.
      return claim.write.status === 'SUCCEEDED'
        ? { deal: await this.markReminded(ctx, claim.write, null), outcome: 'applied' }
        : { deal, outcome: 'unknown' };
    }
    try {
      const res = await this.rest.request({
        method: 'POST',
        path: `${invoicePath(deal.paypalInvoiceId)}/remind`,
        body: {
          subject: `Reminder: invoice ${deal.invoice.number}`,
          ...(note === undefined ? {} : { note }),
          send_to_invoicer: false,
        },
        requestId: claim.write.requestId,
        schema: z.unknown(),
      });
      return { deal: await this.markReminded(ctx, claim.write, res.debugId), outcome: 'applied' };
    } catch (err) {
      const f = classify(err);
      if (mayHaveTakenEffect(f)) {
        await this.ledger.markUnknown(this.db, claim.write.id, {
          kind: f.kind,
          status: f.status,
          debugId: f.debugId,
        });
        await this.recordFailure(ctx, INVOICE_CALLS.remind, f);
        return { deal, outcome: 'unknown' };
      }
      await this.ledger.release(this.db, claim.write.id);
      await this.recordFailure(ctx, INVOICE_CALLS.remind, f);
      if (f.kind === 'refused') {
        await this.deals.transition({
          dealId,
          to: 'FAILED',
          actor: 'SYSTEM',
          reason: `PayPal refused the reminder: ${f.reason ?? f.name ?? String(f.status)}`,
          paypalCall: INVOICE_CALLS.remind,
          paypalDebugId: f.debugId,
          patch: { closedReason: 'PayPal refused the reminder' },
        });
      }
      throw toAppError(f, 'invoice');
    }
  }

  private async markReminded(
    ctx: DealContext,
    write: PayPalWrite,
    debugId: string | null,
  ): Promise<Deal> {
    return this.db.$transaction(async (tx) => {
      await this.ledger.succeed(tx, write.id, ctx.deal.paypalInvoiceId);
      await this.audit.write(tx, {
        actor: 'SYSTEM',
        action: 'REMINDER_SENT',
        subjectType: 'INVOICE',
        subjectId: ctx.deal.invoiceId,
        dealId: ctx.deal.id,
        businessIds: ctx.businessIds,
        summary: `Reminder sent for invoice ${ctx.deal.invoice.number}`,
        paypalCall: INVOICE_CALLS.remind,
        paypalRequestId: write.requestId,
        paypalDebugId: debugId,
      });
      const deal = await this.deals.get(tx, ctx.deal.id);
      if (deal.state !== 'APPROVED') return deal;
      return this.deals.transition(
        {
          dealId: deal.id,
          to: 'SENT',
          actor: 'SYSTEM',
          reason: 'PayPal reminder sent',
          paypalCall: INVOICE_CALLS.remind,
          paypalRequestId: write.requestId,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- record an agent payment

  /**
   * Links an agent's PayPal capture to the deal's invoice. PayPal Invoicing may not find a fresh
   * capture as a PayPal payment (spike S2: 404 until reporting catches up), so a 404 falls back to
   * an external payment whose note carries the capture id. Bookkeeping only: the deal is settled
   * by the verified capture webhook or a server read, not by this call.
   */
  async recordPayment(
    dealId: string,
    capture: { id: string; amountCents: bigint; date: string },
  ): Promise<{ invoicePaymentId: string | null; outcome: WriteOutcome }> {
    const ctx = await this.context(dealId);
    const claim = await this.ledger.claim(this.db, {
      key: `invoice-payment:${capture.id}`,
      operation: 'invoicing.recordPayment',
      dealId,
    });
    if (claim.kind === 'existing') {
      if (claim.write.status === 'SUCCEEDED') {
        return { invoicePaymentId: claim.write.resultRef, outcome: 'applied' };
      }
      return this.settlePayment(ctx, claim.write, capture.id);
    }
    const amount = {
      currency_code: ctx.deal.invoice.currency,
      value: fromCents(capture.amountCents),
    };
    const send = (body: Record<string, unknown>, requestId: string) =>
      this.rest.request({
        method: 'POST',
        path: `${invoicePath(ctx.deal.paypalInvoiceId)}/payments`,
        body: { ...body, payment_date: capture.date, amount },
        requestId,
        schema: z.looseObject({ payment_id: z.string().optional() }),
      });
    const note = `PayPal capture ${capture.id}, paid by ${ctx.deal.client.name}'s agent (Terms deal ${dealId})`;
    try {
      let res;
      let method: 'PAYPAL' | 'OTHER' = 'PAYPAL';
      try {
        res = await send({ method: 'PAYPAL', payment_id: capture.id, note }, claim.write.requestId);
      } catch (err) {
        const f = classify(err);
        if (!(f.kind === 'refused' && f.status === 404)) throw err;
        method = 'OTHER';
        res = await send({ method: 'OTHER', note }, `${claim.write.requestId}-other`);
      }
      const invoicePaymentId = res.data.payment_id ?? null;
      await this.db.$transaction(async (tx) => {
        await this.ledger.succeed(tx, claim.write.id, invoicePaymentId);
        await tx.paymentRecord.updateMany({
          where: { captureId: capture.id },
          data: { status: 'RECORDED', invoicePaymentId },
        });
        await tx.deal.update({ where: { id: dealId }, data: { invoicePaymentId } });
        await this.audit.write(tx, {
          actor: 'SYSTEM',
          action: 'PAYMENT_RECORDED',
          subjectType: 'INVOICE',
          subjectId: ctx.deal.invoiceId,
          dealId,
          businessIds: ctx.businessIds,
          summary: `${formatMoney(capture.amountCents)} recorded on invoice ${ctx.deal.invoice.number} (${method === 'PAYPAL' ? 'PayPal payment' : 'external payment carrying the capture id'})`,
          details: { captureId: capture.id, method, invoicePaymentId },
          paypalCall: INVOICE_CALLS.recordPayment,
          paypalRequestId: claim.write.requestId,
          paypalDebugId: res.debugId,
        });
      });
      return { invoicePaymentId, outcome: 'applied' };
    } catch (err) {
      const f = classify(err);
      if (mayHaveTakenEffect(f)) {
        await this.ledger.markUnknown(this.db, claim.write.id, {
          kind: f.kind,
          status: f.status,
          debugId: f.debugId,
        });
        return this.settlePayment(ctx, claim.write, capture.id);
      }
      await this.ledger.release(this.db, claim.write.id);
      await this.recordFailure(ctx, INVOICE_CALLS.recordPayment, f);
      throw toAppError(f, 'invoice');
    }
  }

  /** Finds a payment carrying the capture id on the invoice, either as its id or in its note. */
  private async settlePayment(
    ctx: DealContext,
    write: PayPalWrite,
    captureId: string,
  ): Promise<{ invoicePaymentId: string | null; outcome: WriteOutcome }> {
    let wire: WireInvoice;
    try {
      wire = await this.read(ctx.deal.paypalInvoiceId);
    } catch {
      return { invoicePaymentId: null, outcome: 'unknown' };
    }
    const match = (wire.payments?.transactions ?? []).find(
      (t) =>
        t.payment_id === captureId ||
        (typeof t['note'] === 'string' && t['note'].includes(captureId)),
    );
    if (match === undefined) return { invoicePaymentId: null, outcome: 'unknown' };
    const invoicePaymentId = match.payment_id ?? null;
    await this.ledger.succeed(this.db, write.id, invoicePaymentId);
    await this.db.paymentRecord.updateMany({
      where: { captureId },
      data: { status: 'RECORDED', invoicePaymentId },
    });
    return { invoicePaymentId, outcome: 'applied' };
  }
}
