/**
 * Agent payments (CONTEXT.md money flows 2 and 3; spike S2; paypal-plan.md I-1, I-2, I-4).
 *
 * A client's agent pays an AWAITING_PAYMENT deal from the client's saved PayPal method: an order to
 * the app owner (Maya) funded by the vault token, which completes at create. Before any money moves:
 *  - I-4: the amount is exactly the agreed payment (amountEarly − discount); above the client's
 *    auto-pay limit it needs an APPROVED CLIENT_PAYMENT approval for that amount;
 *  - I-1: the token is the paying client's own ACTIVE vault token;
 *  - I-2: no payee is ever set, so PayPal pays the app owner.
 * The order is claimed once per deal and carries the claim's PayPal-Request-Id; a lost answer is
 * settled by replaying it (PayPal returns the same order). The deal is NOT marked paid here: the
 * verified PAYMENT.CAPTURE.COMPLETED webhook or a server read does that (settlement).
 */
import {
  checkAutoPayLimit,
  formatMoney,
  fromCents,
  isoDateInTimeZone,
  NegotiationTerms,
  paymentFor,
  percentToBps,
  toCents,
} from '@terms/shared';
import { type PaypalClient } from 'paypal';
import { type AuditLogger } from '../audit.js';
import { type Db } from '../db.js';
import { type DealStore } from '../deals/deal-store.js';
import { conflict, notFound, policyBlocked } from '../errors.js';
import { type Deal } from '../generated/prisma/client.js';
import { incompleteResponse, toAppError } from './errors.js';
import { type InvoiceService } from './invoice-service.js';
import { callBudget } from './sdk-client.js';
import { outcomeUnknown, sendClaimed, type WriteLedger } from './write-ledger.js';

export const ORDER_CALLS = {
  create: 'POST /v2/checkout/orders',
  capture: 'POST /v2/checkout/orders/{id}/capture',
  get: 'GET /v2/checkout/orders/{id}',
} as const;

type Order = Awaited<ReturnType<PaypalClient['orders']['createOrder']>>;

export interface PaymentResult {
  deal: Deal;
  orderId: string;
  captureId: string;
  /** COMPLETED, or PENDING while PayPal reviews it; the webhook settles either way. */
  captureStatus: string;
  amountCents: bigint;
}

function captureOf(order: Order) {
  const capture = order.purchaseUnits?.[0]?.payments?.captures?.[0];
  return capture?.id === undefined ? null : { ...capture, id: capture.id };
}

export class PaymentService {
  constructor(
    private readonly db: Db,
    private readonly sdk: PaypalClient,
    private readonly ledger: WriteLedger,
    private readonly audit: AuditLogger,
    private readonly deals: DealStore,
    private readonly invoices: InvoiceService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The agreed payment for a deal, and whether a person must approve it first. */
  async paymentDue(dealId: string) {
    const deal = await this.db.deal.findUnique({
      where: { id: dealId },
      include: {
        invoice: true,
        client: { include: { clientPolicy: true } },
        plan: { include: { goal: true } },
      },
    });
    if (deal === null) throw notFound('Deal');
    const agreed = NegotiationTerms.safeParse(deal.agreedTerms);
    if (!agreed.success) throw conflict('Deal has no agreed terms');
    const amountCents = paymentFor(
      toCents(agreed.data.amountEarly),
      percentToBps(agreed.data.discountPct),
    );
    const policy = deal.client.clientPolicy;
    if (policy === null) throw conflict(`${deal.client.name} has no payment policy`);
    return {
      deal,
      amountCents,
      limitCheck: checkAutoPayLimit(amountCents, policy.autoPayLimitCents),
    };
  }

  /** The client's agent pays the deal's agreed amount from the saved PayPal method. */
  async payWithVault(dealId: string): Promise<PaymentResult> {
    const { deal, amountCents, limitCheck } = await this.paymentDue(dealId);
    const businessIds = [deal.plan.goal.supplierId, deal.clientId];
    if (deal.state !== 'AWAITING_PAYMENT') {
      throw conflict(`Deal is ${deal.state}; the invoice must carry the agreed terms first`);
    }
    // I-4: above the auto-pay limit, a person at the client must have approved this exact amount.
    if (limitCheck.result !== 'pass') {
      const approval = await this.db.approval.findFirst({
        where: {
          dealId,
          type: 'CLIENT_PAYMENT',
          decision: 'APPROVED',
          paymentAmountCents: amountCents,
        },
      });
      if (approval === null)
        throw policyBlocked('A person at the client must approve this payment', [limitCheck]);
    }
    // I-1: the client's own active token.
    const token = await this.db.vaultToken.findFirst({
      where: { clientId: deal.clientId, status: 'ACTIVE', paypalPaymentTokenId: { not: null } },
    });
    const vaultId = token?.paypalPaymentTokenId ?? null;
    if (vaultId === null) throw conflict(`${deal.client.name} has not saved a PayPal method`);

    const claim = await this.ledger.claim(this.db, {
      key: `order:${dealId}`,
      operation: 'orders.createOrder',
      dealId,
    });
    if (claim.kind === 'existing' && claim.write.status === 'SUCCEEDED') {
      throw conflict('This deal has already been paid by its agent');
    }
    const create = () =>
      this.sdk.orders.createOrder(
        {
          payPalRequestId: claim.write.requestId,
          prefer: 'return=representation',
          body: {
            intent: 'CAPTURE',
            purchaseUnits: [
              {
                amount: { currencyCode: deal.invoice.currency, value: fromCents(amountCents) },
                // Unique per merchant: the invoice number alone would refuse a second order.
                invoiceId: `${deal.invoice.number}-${dealId}`,
                customId: dealId,
                description: `Early payment of invoice ${deal.invoice.number}`,
              },
            ],
            paymentSource: { paypal: { vaultId } },
          },
        },
        { signal: callBudget() },
      );
    // A claim left UNKNOWN by an earlier attempt is settled by the same replay.
    const sent = await sendClaimed(this.ledger, this.db, claim.write, create);
    if (!sent.ok) {
      if (sent.unknown) throw outcomeUnknown('taken the payment', sent.failure);
      await this.audit.write(this.db, {
        actor: 'CLIENT_AGENT',
        action: 'PAYPAL_ERROR',
        subjectType: 'DEAL',
        subjectId: dealId,
        businessIds,
        summary: `PayPal refused the payment for invoice ${deal.invoice.number}${sent.failure.reason === null ? '' : `: ${sent.failure.reason}`}`,
        details: { kind: sent.failure.kind, status: sent.failure.status },
        paypalCall: ORDER_CALLS.create,
        paypalDebugId: sent.failure.debugId,
      });
      if (sent.failure.kind === 'refused') {
        await this.deals.transition({
          dealId,
          to: 'FAILED',
          actor: 'SYSTEM',
          reason: `PayPal refused the payment: ${sent.failure.reason ?? sent.failure.name ?? String(sent.failure.status)}`,
          paypalCall: ORDER_CALLS.create,
          paypalDebugId: sent.failure.debugId,
          patch: { closedReason: 'PayPal refused the payment' },
        });
      }
      throw toAppError(sent.failure, 'order');
    }

    let order = sent.value;
    if (order.id === undefined) {
      await this.ledger.markUnknown(this.db, claim.write.id, { kind: 'incomplete_response' });
      throw outcomeUnknown('taken the payment', incompleteResponse(ORDER_CALLS.create));
    }
    const orderId = order.id;
    // A vault order completes at create (S2); capture only if PayPal left it approved.
    if (order.status === 'APPROVED') order = await this.capture(orderId, dealId);
    const capture = captureOf(order);
    if (capture === null) {
      await this.ledger.markUnknown(this.db, claim.write.id, { kind: 'no_capture' });
      throw outcomeUnknown('taken the payment', incompleteResponse(ORDER_CALLS.create));
    }
    const captureStatus = capture.status ?? 'UNKNOWN';
    const supplier = await this.db.business.findUniqueOrThrow({
      where: { id: deal.plan.goal.supplierId },
    });

    const updated = await this.db.$transaction(async (tx) => {
      await this.ledger.succeed(tx, claim.write.id, orderId);
      await tx.paymentRecord.upsert({
        where: { paypalOrderId: orderId },
        create: {
          dealId,
          paypalOrderId: orderId,
          captureId: capture.id,
          amountCents,
          status:
            captureStatus === 'COMPLETED' || captureStatus === 'PENDING' ? 'CAPTURED' : 'FAILED',
        },
        update: { captureId: capture.id },
      });
      await tx.deal.update({
        where: { id: dealId },
        data: { paypalOrderId: orderId, paypalCaptureId: capture.id },
      });
      await this.audit.write(tx, {
        actor: 'CLIENT_AGENT',
        action: 'ORDER_CAPTURED',
        subjectType: 'PAYMENT',
        subjectId: orderId,
        dealId,
        businessIds,
        summary: `${deal.client.name}'s agent paid ${formatMoney(amountCents)} from its saved PayPal method (capture ${captureStatus.toLowerCase()})`,
        details: { orderId, captureId: capture.id, captureStatus, replayed: sent.replayed },
        paypalCall: ORDER_CALLS.create,
        paypalRequestId: claim.write.requestId,
      });
      return tx.deal.findUniqueOrThrow({ where: { id: dealId } });
    });

    if (captureStatus === 'COMPLETED') {
      // Bookkeeping on the invoice. Its failure never undoes the payment; the claim is retried.
      await this.invoices
        .recordPayment(dealId, {
          id: capture.id,
          amountCents,
          date: isoDateInTimeZone(this.now(), supplier.timeZone),
        })
        .catch(() => undefined);
    }
    return { deal: updated, orderId, captureId: capture.id, captureStatus, amountCents };
  }

  private async capture(orderId: string, dealId: string): Promise<Order> {
    const claim = await this.ledger.claim(this.db, {
      key: `capture:${orderId}`,
      operation: 'orders.captureOrder',
      dealId,
    });
    const sent = await sendClaimed(this.ledger, this.db, claim.write, () =>
      this.sdk.orders.captureOrder(
        { id: orderId, payPalRequestId: claim.write.requestId, prefer: 'return=representation' },
        { signal: callBudget() },
      ),
    );
    if (!sent.ok) {
      if (sent.unknown) throw outcomeUnknown('captured the payment', sent.failure);
      throw toAppError(sent.failure, 'order');
    }
    await this.ledger.succeed(this.db, claim.write.id, captureOf(sent.value)?.id ?? null);
    return sent.value;
  }
}
