/**
 * Settlement: the only place a deal becomes PAID or PARTIALLY_PAID (CONTEXT.md principle 1: PayPal
 * is the source of truth for money). Two kinds of evidence, both from PayPal:
 *  - a capture (PAYMENT.CAPTURE.COMPLETED webhook, verified): an agent paid the deal;
 *  - an invoice as PayPal holds it (INVOICING.INVOICE.PAID webhook, or a server read): someone paid
 *    the invoice. There is no PARTIALLY_PAID event type; the invoice's own status decides (S3).
 * Transitions are made by the PAYPAL actor, so the deal store's actor rules apply.
 */
import {
  formatMoney,
  isFinal,
  NegotiationTerms,
  paymentFor,
  percentToBps,
  toCents,
} from '@terms/shared';
import { type AuditLogger } from '../audit.js';
import { type Db } from '../db.js';
import { type DealStore } from '../deals/deal-store.js';
import { type Deal } from '../generated/prisma/client.js';
import { type InvoiceService } from './invoice-service.js';
import { figuresOf, type WireInvoice } from './invoice-wire.js';

export interface CaptureEvidence {
  captureId: string;
  /** `custom_id` on the capture: the Terms deal id the order was created for. */
  dealId: string | null;
  status: string;
  amountCents: bigint;
  orderId: string | null;
  /** Where the evidence came from, for the audit trail, e.g. "webhook PAYMENT.CAPTURE.COMPLETED". */
  source: string;
}

export type SettleResult = { settled: true; deal: Deal } | { settled: false; reason: string };

/** A split deal leaves a remainder due on the original date; a full one pays everything early. */
function isSplit(agreed: NegotiationTerms): boolean {
  return agreed.remainderDue !== null;
}

export class Settlement {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly deals: DealStore,
    private readonly invoices: InvoiceService,
  ) {}

  /** An agent's capture completed: settle its deal if the amount is exactly what was agreed. */
  async fromCapture(evidence: CaptureEvidence): Promise<SettleResult> {
    if (evidence.status !== 'COMPLETED')
      return { settled: false, reason: `capture ${evidence.status}` };
    if (evidence.dealId === null) return { settled: false, reason: 'capture has no Terms deal id' };
    const deal = await this.db.deal.findUnique({
      where: { id: evidence.dealId },
      include: { plan: { include: { goal: true } } },
    });
    if (deal === null) return { settled: false, reason: `no deal ${evidence.dealId}` };
    if (deal.state === 'PAID' || deal.state === 'PARTIALLY_PAID') {
      return { settled: false, reason: `deal already ${deal.state}` };
    }
    const agreed = NegotiationTerms.safeParse(deal.agreedTerms);
    if (!agreed.success) return { settled: false, reason: 'deal has no agreed terms' };
    const expected = paymentFor(
      toCents(agreed.data.amountEarly),
      percentToBps(agreed.data.discountPct),
    );
    if (evidence.amountCents !== expected) {
      await this.audit.write(this.db, {
        actor: 'PAYPAL',
        action: 'PAYPAL_ERROR',
        subjectType: 'DEAL',
        subjectId: deal.id,
        businessIds: [deal.plan.goal.supplierId, deal.clientId],
        summary: `Capture ${evidence.captureId} is ${formatMoney(evidence.amountCents)}, not the agreed ${formatMoney(expected)}; not settled`,
        details: { captureId: evidence.captureId, expected, received: evidence.amountCents },
      });
      return { settled: false, reason: 'amount differs from the agreed payment' };
    }

    const to = isSplit(agreed.data) ? 'PARTIALLY_PAID' : 'PAID';
    const settled = await this.db.$transaction(async (tx) => {
      await tx.paymentRecord.upsert({
        where: { captureId: evidence.captureId },
        create: {
          dealId: deal.id,
          captureId: evidence.captureId,
          paypalOrderId: evidence.orderId,
          amountCents: evidence.amountCents,
          status: 'CAPTURED',
        },
        update: {},
      });
      return this.deals.transition(
        {
          dealId: deal.id,
          to,
          actor: 'PAYPAL',
          reason: `PayPal confirmed ${formatMoney(evidence.amountCents)} (capture ${evidence.captureId}, ${evidence.source})`,
          paypalCall: evidence.source,
          patch: {
            paypalCaptureId: evidence.captureId,
            ...(evidence.orderId === null ? {} : { paypalOrderId: evidence.orderId }),
          },
          details: { captureId: evidence.captureId, amount: evidence.amountCents },
        },
        tx,
      );
    });
    return { settled: true, deal: settled };
  }

  /**
   * An invoice as PayPal holds it: mirror it, then settle the deal open on it. PAID settles the
   * deal PAID; PARTIALLY_PAID settles an unsettled deal PARTIALLY_PAID.
   */
  async fromInvoice(wire: WireInvoice, source: string): Promise<SettleResult> {
    const invoice = await this.db.invoice.findUnique({ where: { paypalInvoiceId: wire.id } });
    if (invoice === null) return { settled: false, reason: `invoice ${wire.id} is not mirrored` };
    await this.invoices.mirror(this.db, invoice.id, wire);
    const status = wire.status;
    if (status !== 'PAID' && status !== 'PARTIALLY_PAID' && status !== 'MARKED_AS_PAID') {
      return { settled: false, reason: `invoice is ${status}` };
    }
    const candidates = await this.db.deal.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' },
    });
    const deal = candidates.find(
      (d) => !isFinal(d.state) || (d.state === 'PARTIALLY_PAID' && status !== 'PARTIALLY_PAID'),
    );
    if (deal === undefined) return { settled: false, reason: 'no open deal on this invoice' };
    const to = status === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'PAID';
    const f = figuresOf(wire);
    const settled = await this.deals.transition({
      dealId: deal.id,
      to,
      actor: 'PAYPAL',
      reason: `PayPal shows invoice ${invoice.number} ${status.toLowerCase().replaceAll('_', ' ')}: ${formatMoney(f.paidCents)} paid, ${formatMoney(f.dueCents)} due (${source})`,
      paypalCall: source,
      details: { paid: f.paidCents, due: f.dueCents, invoiceStatus: status },
    });
    return { settled: true, deal: settled };
  }
}
