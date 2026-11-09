import { z } from 'zod';
import { ActionType, Actor, DealState } from '../enums.js';
import { AnnualRate, BusinessRef, Id, IsoDateTime, MoneyAmount, PayPalId } from './common.js';
import { ApprovalView } from './approvals.js';
import { NegotiationMessage, NegotiationTerms } from './negotiation.js';

export const DealSummary = z.object({
  id: Id,
  planId: Id,
  planItemId: Id,
  /** Terms invoice record ID. */
  invoiceId: Id,
  invoiceNumber: z.string(),
  client: BusinessRef,
  action: ActionType,
  state: DealState,
  /** The latest terms on the table (offer or counter); null for reminders. */
  currentTerms: NegotiationTerms.nullable(),
  /** Set once the deal reaches AGREED. */
  agreedTerms: NegotiationTerms.nullable(),
  impliedAnnualRate: AnnualRate.nullable(),
  /** Discount cost of the current (or agreed) terms. */
  cost: MoneyAmount,
  /** Cash this deal commits once agreed: amountEarly − discount. "0.00" for reminders. */
  committedIfAgreed: MoneyAmount,
  /** True only in AGREED, INVOICE_UPDATED, AWAITING_PAYMENT, PAID, PARTIALLY_PAID. */
  countsAsCommitted: z.boolean(),
  round: z.number().int().min(0).max(3),
  /** Pending NEEDS_OWNER or client-payment approval, if any. */
  pendingApprovalId: Id.nullable(),
  /** Why the deal closed, for DECLINED / EXPIRED / WITHDRAWN / FAILED. */
  closedReason: z.string().nullable(),
  updatedAt: IsoDateTime,
});
export type DealSummary = z.infer<typeof DealSummary>;

export const DealTransition = z.object({
  from: DealState.nullable(),
  to: DealState,
  actor: Actor,
  reason: z.string(),
  at: IsoDateTime,
});
export type DealTransition = z.infer<typeof DealTransition>;

export const DealPayPalRefs = z.object({
  invoiceId: PayPalId,
  /** Set when the invoice was cancelled and reissued (spike S1 fallback). */
  reissuedInvoiceId: PayPalId.nullable(),
  orderId: PayPalId.nullable(),
  captureId: PayPalId.nullable(),
  invoicePaymentId: PayPalId.nullable(),
  /** Link for the payer to pay the updated invoice, or to approve an agent payment. */
  payerUrl: z.url().nullable(),
});
export type DealPayPalRefs = z.infer<typeof DealPayPalRefs>;

/** GET /api/deals/:id — visible to the owner and to the deal's client. */
export const DealDetail = DealSummary.extend({
  paypal: DealPayPalRefs,
  messages: z.array(NegotiationMessage),
  history: z.array(DealTransition),
  approvals: z.array(ApprovalView),
});
export type DealDetail = z.infer<typeof DealDetail>;

/** GET /api/deals — deals for the owner's plan (defaults to the active plan). */
export const ListDealsQuery = z.object({
  planId: Id.optional(),
  state: DealState.optional(),
});
export type ListDealsQuery = z.infer<typeof ListDealsQuery>;

export const ListDealsResponse = z.object({
  planId: Id.nullable(),
  deals: z.array(DealSummary),
});
export type ListDealsResponse = z.infer<typeof ListDealsResponse>;
