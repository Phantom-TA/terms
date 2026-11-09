import { z } from 'zod';
import { DealState, VaultStatus } from '../enums.js';
import {
  AnnualRate,
  BusinessRef,
  Id,
  IsoDate,
  IsoDateTime,
  MoneyAmount,
  PolicyCheckView,
  PositiveMoney,
} from './common.js';
import { NegotiationTerms } from './negotiation.js';

/** What the client agent's policy says about an offer. */
export const OfferRecommendation = z.enum(['ACCEPT', 'COUNTER', 'DECLINE', 'NEEDS_HUMAN']);
export type OfferRecommendation = z.infer<typeof OfferRecommendation>;

/** An offer on the client's Payables Desk. */
export const ClientOffer = z.object({
  dealId: Id,
  supplier: BusinessRef,
  invoice: z.object({
    id: Id,
    number: z.string(),
    amount: PositiveMoney,
    dueDate: IsoDate,
  }),
  state: DealState,
  /** Latest terms on the table. */
  terms: NegotiationTerms,
  /** What the client pays now under these terms. */
  payNow: PositiveMoney,
  /** What the client saves. */
  discountAmount: MoneyAmount,
  daysEarly: z.number().int().min(1),
  impliedAnnualRate: AnnualRate,
  /** Client-side policy checks on these terms. */
  policyChecks: z.array(PolicyCheckView),
  recommendation: OfferRecommendation,
  round: z.number().int().min(1).max(3),
  expiresAt: IsoDateTime.nullable(),
  /** Pending CLIENT_PAYMENT approval for a person at the client, if any. */
  pendingApprovalId: Id.nullable(),
  updatedAt: IsoDateTime,
});
export type ClientOffer = z.infer<typeof ClientOffer>;

/** GET /api/client/offers — incoming offers ranked by annualised return. Client only. */
export const ListClientOffersQuery = z.object({
  /** OPEN: still negotiable or awaiting payment; CLOSED: final; ALL: both. Default OPEN. */
  status: z.enum(['OPEN', 'CLOSED', 'ALL']).default('OPEN'),
});
export type ListClientOffersQuery = z.infer<typeof ListClientOffersQuery>;

export const ListClientOffersResponse = z.object({
  /** Sorted by impliedAnnualRate, highest first. */
  offers: z.array(ClientOffer),
  cashPosition: z.object({
    available: MoneyAmount,
    buffer: MoneyAmount,
    /** available − buffer when positive, else "0.00". */
    spendableEarly: MoneyAmount,
    asOf: IsoDateTime,
  }),
});
export type ListClientOffersResponse = z.infer<typeof ListClientOffersResponse>;

export const VaultView = z.object({
  status: VaultStatus,
  /** PayPal payment token ID once ACTIVE. */
  paymentTokenId: z.string().nullable(),
  /** Payer email of the saved PayPal wallet, when known. */
  payerEmail: z.string().nullable(),
  updatedAt: IsoDateTime.nullable(),
});
export type VaultView = z.infer<typeof VaultView>;

/** GET /api/client/vault — whether the client agent has a saved PayPal method. */
export const VaultResponse = z.object({ vault: VaultView });
export type VaultResponse = z.infer<typeof VaultResponse>;

/** POST /api/client/vault/setup — no body; starts saving the client's PayPal method. */
export const VaultSetupRequest = z.strictObject({});
export type VaultSetupRequest = z.infer<typeof VaultSetupRequest>;

export const VaultSetupResponse = z.object({
  setupTokenId: z.string(),
  /** PayPal page where a person at the client approves saving the method (one human approval). */
  approvalUrl: z.url(),
});
export type VaultSetupResponse = z.infer<typeof VaultSetupResponse>;

/** POST /api/client/vault/confirm — after the person returns from PayPal. */
export const VaultConfirmRequest = z.strictObject({
  setupTokenId: z.string().min(1),
});
export type VaultConfirmRequest = z.infer<typeof VaultConfirmRequest>;
