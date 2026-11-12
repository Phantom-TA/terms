import { z } from 'zod';
import { ApprovalDecision, ApprovalRequestedFrom, ApprovalType } from '../enums.js';
import { Id, IsoDateTime, Money, MoneyAmount } from './common.js';
import { NegotiationTerms } from './negotiation.js';

/** How an approval changes the plan's cost. */
export const CostImpact = z.object({
  planCostBefore: MoneyAmount,
  planCostAfter: MoneyAmount,
  /** planCostAfter − planCostBefore. */
  delta: Money,
  ceiling: MoneyAmount,
  /** planCostAfter − ceiling when positive, else "0.00". */
  overCeilingBy: MoneyAmount,
});
export type CostImpact = z.infer<typeof CostImpact>;

export const ApprovalView = z.object({
  id: Id,
  type: ApprovalType,
  requestedFrom: ApprovalRequestedFrom,
  decision: ApprovalDecision,
  /** Short title, e.g. "Counter to Harbor & Co at 1.20%". */
  title: z.string(),
  /** One or two sentences explaining what approving does. */
  summary: z.string(),
  planId: Id.nullable(),
  dealId: Id.nullable(),
  /** Proposed terms, for counter, backup and client-payment approvals. */
  terms: NegotiationTerms.nullable(),
  /** For client payments: the amount the person at the client approves. */
  paymentAmount: MoneyAmount.nullable(),
  costImpact: CostImpact.nullable(),
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  decisionNote: z.string().nullable(),
});
export type ApprovalView = z.infer<typeof ApprovalView>;

/** GET /api/approvals — approvals addressed to the session's business. */
export const ListApprovalsQuery = z.object({
  decision: ApprovalDecision.optional(),
  type: ApprovalType.optional(),
});
export type ListApprovalsQuery = z.infer<typeof ListApprovalsQuery>;

export const ListApprovalsResponse = z.object({
  approvals: z.array(ApprovalView),
});
export type ListApprovalsResponse = z.infer<typeof ListApprovalsResponse>;

/** POST /api/approvals/:id — decide a pending approval. */
export const DecideApprovalRequest = z.strictObject({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(500).optional(),
});
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequest>;

export const DecideApprovalResponse = z.object({
  approval: ApprovalView,
  /**
   * For an approved CLIENT_PAYMENT by a client with no saved PayPal method: PayPal's own invoice
   * page, where the person at the client pays. PayPal does not send the person back from it, so
   * the UI opens it in a new tab and stays where it is; the deal moves on (deal.updated) only when
   * PayPal's payment webhook arrives. Null when Terms paid with the saved method.
   */
  paypalApprovalUrl: z.url().nullable(),
});
export type DecideApprovalResponse = z.infer<typeof DecideApprovalResponse>;
