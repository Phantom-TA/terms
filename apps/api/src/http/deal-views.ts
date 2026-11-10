/**
 * Wire views of deals, their messages and history (DealSummary, DealDetail, NegotiationMessage).
 *
 * A deal is shared by its supplier and its client, but each side's policy is its own: every view
 * takes the viewing business and shows it only its own approvals, its own side's private reasons
 * and the policy checks on the messages its side sent (docs/api.md, "Visibility on a shared deal").
 */
import {
  type ApprovalView,
  type DealDetail,
  type DealSummary,
  diffDays,
  impliedAnnualRate,
  isCommitted,
  type NegotiationMessage as MessageView,
  NegotiationTerms,
  percentToBps,
  PolicyCheckView,
} from '@terms/shared';
import { toApprovalView } from '../approvals/approval-service.js';
import { type DbOrTx } from '../db.js';
import { notFound } from '../errors.js';
import {
  type BusinessRole,
  type NegotiationMessage,
  type Prisma,
} from '../generated/prisma/client.js';
import { dateToIso, money } from '../mappers.js';
import { businessRef } from './views.js';

export const dealSummaryInclude = {
  invoice: true,
  client: true,
  approvals: {
    where: { decision: 'PENDING' },
    select: { id: true, businessId: true },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.DealInclude;

type DealForSummary = Prisma.DealGetPayload<{ include: typeof dealSummaryInclude }>;

function terms(json: unknown): NegotiationTerms | null {
  const parsed = NegotiationTerms.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** The deal as `viewerId` (its supplier or its client) sees it. */
export function dealSummary(deal: DealForSummary, viewerId: string): DealSummary {
  const current = terms(deal.currentTerms);
  const agreed = terms(deal.agreedTerms);
  const shown = agreed ?? current;
  const days = shown === null ? 0 : diffDays(dateToIso(deal.invoice.dueDate), shown.payBy);
  return {
    id: deal.id,
    planId: deal.planId,
    planItemId: deal.planItemId,
    invoiceId: deal.invoiceId,
    invoiceNumber: deal.invoice.number,
    client: businessRef(deal.client),
    action: deal.action,
    state: deal.state,
    currentTerms: current,
    agreedTerms: agreed,
    impliedAnnualRate:
      shown !== null && days >= 1 ? impliedAnnualRate(percentToBps(shown.discountPct), days) : null,
    cost: money(deal.costCents),
    committedIfAgreed: money(deal.committedCents),
    countsAsCommitted: deal.action !== 'REMINDER' && isCommitted(deal.state),
    round: deal.round,
    pendingApprovalId: deal.approvals.find((a) => a.businessId === viewerId)?.id ?? null,
    closedReason: deal.closedReason,
    updatedAt: deal.updatedAt.toISOString(),
  };
}

/** A message; `showChecks` only for the side that sent it, since the checks are its policy. */
export function messageView(
  m: NegotiationMessage,
  paypalInvoiceId: string,
  showChecks: boolean,
): MessageView {
  const checks = PolicyCheckView.array().safeParse(m.policyChecks);
  return {
    id: m.id,
    dealId: m.dealId,
    invoiceId: paypalInvoiceId,
    from: m.fromParty,
    to: m.toParty,
    actor: m.actor,
    type: m.type,
    terms: terms(m.terms),
    impliedAnnualRate: m.impliedAnnualRate,
    payNow: m.payNowCents === null ? null : money(m.payNowCents),
    note: m.note,
    policyChecks: showChecks && checks.success ? checks.data : [],
    expiresAt: m.expiresAt?.toISOString() ?? null,
    round: m.round,
    createdAt: m.createdAt.toISOString(),
  };
}

/** The side a message party ("supplier:maya", "client:harbor") speaks for. */
function sideOf(party: string): BusinessRole {
  return party.startsWith('supplier:') ? 'SUPPLIER' : 'CLIENT';
}

/** A deal visible to its supplier or its client; anyone else gets NOT_FOUND. */
export async function loadDealFor(db: DbOrTx, dealId: string, businessId: string) {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    include: {
      ...dealSummaryInclude,
      plan: { select: { goal: { select: { supplierId: true } } } },
    },
  });
  if (deal === null || (deal.plan.goal.supplierId !== businessId && deal.clientId !== businessId)) {
    throw notFound('Deal');
  }
  return deal;
}

export async function dealDetail(
  db: DbOrTx,
  dealId: string,
  businessId: string,
): Promise<DealDetail> {
  const deal = await loadDealFor(db, dealId, businessId);
  const viewer: BusinessRole = deal.plan.goal.supplierId === businessId ? 'SUPPLIER' : 'CLIENT';
  const [messages, history, approvals] = await Promise.all([
    db.negotiationMessage.findMany({
      where: { dealId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.dealTransition.findMany({ where: { dealId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] }),
    db.approval.findMany({ where: { dealId, businessId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    ...dealSummary(deal, businessId),
    paypal: {
      invoiceId: deal.paypalInvoiceId,
      reissuedInvoiceId: deal.reissuedInvoiceId,
      orderId: deal.paypalOrderId,
      captureId: deal.paypalCaptureId,
      invoicePaymentId: deal.invoicePaymentId,
      payerUrl: deal.payerUrl,
    },
    messages: messages.map((m) =>
      messageView(m, deal.paypalInvoiceId, sideOf(m.fromParty) === viewer),
    ),
    history: history.map((h) => ({
      from: h.fromState,
      to: h.toState,
      actor: h.actor,
      reason: h.privateReason !== null && h.privateTo === viewer ? h.privateReason : h.reason,
      at: h.at.toISOString(),
    })),
    approvals: approvals.map((a): ApprovalView => toApprovalView(a)),
  };
}
