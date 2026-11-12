import { z } from 'zod';
import {
  AnnualRate,
  Currency,
  IsoDate,
  IsoDateTime,
  MoneyAmount,
  PositiveMoney,
} from './common.js';
import { NegotiationTerms } from './negotiation.js';

/** Max length of a human client's free-text reply. */
export const OFFER_REPLY_MAX_LENGTH = 2000;

/**
 * GET /api/offer/:token — the public offer page for a human client. The token is a single-use
 * signed token with an expiry; viewing does not use it up, replying does.
 * The SPA renders this at /offer/:token.
 */
export const PublicOffer = z.object({
  supplierName: z.string(),
  clientName: z.string(),
  invoiceNumber: z.string(),
  invoiceAmount: PositiveMoney,
  currency: Currency,
  originalDueDate: IsoDate,
  terms: NegotiationTerms,
  /** "Pay $4,950 today instead of $5,000 on the 27th". */
  payNow: PositiveMoney,
  discountAmount: MoneyAmount,
  impliedAnnualRate: AnnualRate,
  /** Whether "Pay part now" is offered, and the smallest part accepted. */
  allowPartial: z.boolean(),
  minPartial: PositiveMoney.nullable(),
  /** OPEN until the client replies; then the outcome. */
  state: z.enum(['OPEN', 'ACCEPTED', 'COUNTERED', 'DECLINED', 'EXPIRED', 'WITHDRAWN', 'PAID']),
  /** PayPal invoice link, present once the invoice carries the agreed terms. */
  payUrl: z.url().nullable(),
  expiresAt: IsoDateTime,
  /** Short note from the supplier, written by the message writer. */
  note: z.string(),
  demo: z.boolean(),
});
export type PublicOffer = z.infer<typeof PublicOffer>;

export const PublicOfferResponse = z.object({ offer: PublicOffer });
export type PublicOfferResponse = z.infer<typeof PublicOfferResponse>;

/** POST /api/offer/:token/reply — one of the four buttons or a free-text reply. */
export const OfferReplyRequest = z.discriminatedUnion('kind', [
  /** Accept the offer as it stands. */
  z.strictObject({ kind: z.literal('PAY_NOW') }),
  /** Pay part of the invoice early at the offered discount. */
  z.strictObject({ kind: z.literal('PAY_PART'), amountEarly: PositiveMoney }),
  /** Decline; the invoice stays due on its original date. */
  z.strictObject({ kind: z.literal('NOT_NOW') }),
  /** Free text; parsed by the reply parser into a structured counter or "no change". */
  z.strictObject({
    kind: z.literal('TEXT'),
    text: z.string().trim().min(1).max(OFFER_REPLY_MAX_LENGTH),
  }),
]);
export type OfferReplyRequest = z.infer<typeof OfferReplyRequest>;

/** How the reply parser read a free-text reply. Shown back to the client for transparency. */
export const ParsedReply = z.object({
  interpretation: z.enum(['ACCEPT', 'COUNTER', 'DECLINE', 'PROMISE_TO_PAY', 'NO_CHANGE']),
  /** Structured counter, when the reply proposed different terms. */
  terms: NegotiationTerms.nullable(),
  /** For PROMISE_TO_PAY: "Can pay half Monday" → $900 on Monday. Best effort, never counted. */
  promise: z.object({ amount: PositiveMoney, date: IsoDate }).nullable(),
  /** One-sentence summary, e.g. "$900 on Monday 16 Nov". */
  summary: z.string(),
});
export type ParsedReply = z.infer<typeof ParsedReply>;

export const OfferReplyResponse = z.object({
  offer: PublicOffer,
  /** Message to show the client after replying. */
  message: z.string(),
  parsed: ParsedReply.nullable(),
});
export type OfferReplyResponse = z.infer<typeof OfferReplyResponse>;
