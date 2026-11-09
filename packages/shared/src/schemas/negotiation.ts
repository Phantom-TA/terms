import { z } from 'zod';
import { Actor, MessageType } from '../enums.js';
import {
  AnnualRate,
  Id,
  IsoDate,
  IsoDateTime,
  PartyRef,
  PayPalId,
  Percent,
  PolicyCheckView,
  PositiveMoney,
} from './common.js';

/** The terms of an early payment (CONTEXT.md, "Negotiation protocol"). */
export const NegotiationTerms = z.object({
  /** Portion of the invoice paid early, before the discount. */
  amountEarly: PositiveMoney,
  /** Discount on the early portion, e.g. "1.20". */
  discountPct: Percent,
  /** Date the early payment is due. */
  payBy: IsoDate,
  /** For a split deal: when the rest is due (the original due date). Null when paying in full. */
  remainderDue: IsoDate.nullable(),
});
export type NegotiationTerms = z.infer<typeof NegotiationTerms>;

/** Max length of the human-readable note an agent writes on a message. */
export const NOTE_MAX_LENGTH = 600;

/** One structured message between the supplier agent and a client agent (or the offer page). */
export const NegotiationMessage = z.object({
  id: Id,
  dealId: Id,
  /** PayPal invoice ID. */
  invoiceId: PayPalId,
  from: PartyRef,
  to: PartyRef,
  /** Who produced the message: an agent, a human client via the offer page, or the owner. */
  actor: Actor,
  type: MessageType,
  /** Present for OFFER, COUNTER and ACCEPT; null for DECLINE and WITHDRAW. */
  terms: NegotiationTerms.nullable(),
  /** Payer's annualised return for these terms, computed in code. */
  impliedAnnualRate: AnnualRate.nullable(),
  /** What the payer pays now: amountEarly minus the discount. */
  payNow: PositiveMoney.nullable(),
  /** Human-readable note written by the agent's model; display only. */
  note: z.string().max(NOTE_MAX_LENGTH),
  /** Checks run by the sender's policy layer before the message was stored. */
  policyChecks: z.array(PolicyCheckView),
  expiresAt: IsoDateTime.nullable(),
  round: z.number().int().min(1).max(3),
  createdAt: IsoDateTime,
});
export type NegotiationMessage = z.infer<typeof NegotiationMessage>;
