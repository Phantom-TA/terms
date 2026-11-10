/** The client side (Payables Desk): incoming offers, the saved PayPal method, and PayPal webhooks. */
import {
  type ClientOffer,
  diffDays,
  discountOn,
  endpoints,
  fromCents,
  impliedAnnualRate,
  isFinal,
  NegotiationTerms,
  paymentFor,
  percentToBps,
  type VaultView,
} from '@terms/shared';
import { type Router } from 'express';
import { AppError, conflict } from '../../errors.js';
import { type VaultToken } from '../../generated/prisma/client.js';
import { dateToIso, money } from '../../mappers.js';
import { wireToTerms } from '../../negotiation/engine.js';
import { clientChecks, clientMove } from '../../negotiation/strategies.js';
import { PAYPAL_HEADERS, type WebhookHeaders } from '../../paypal/webhook-service.js';
import { type PayPalServices, type Services } from '../../services.js';
import { route } from '../route.js';
import { businessRef } from '../views.js';

function vaultView(row: VaultToken | null): VaultView {
  if (row === null)
    return { status: 'NONE', paymentTokenId: null, payerEmail: null, updatedAt: null };
  return {
    status: row.status,
    paymentTokenId: row.paypalPaymentTokenId,
    payerEmail: row.payerEmail,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerClientRoutes(router: Router, s: Services): void {
  const needPayPal = (): PayPalServices => {
    if (s.paypal === null) throw new AppError('NOT_CONFIGURED', 'PayPal is not configured');
    return s.paypal;
  };
  const currentVault = (clientId: string) =>
    s.db.vaultToken.findFirst({
      where: { clientId },
      orderBy: [{ updatedAt: 'desc' }],
    });

  // ---------------------------------------------------------------- incoming offers

  route(router, s.sessions, endpoints.listClientOffers, async ({ query, session }) => {
    const policy = await s.db.clientPolicy.findUnique({
      where: { businessId: session.businessId },
    });
    const deals = await s.db.deal.findMany({
      where: { clientId: session.businessId, action: { not: 'REMINDER' } },
      include: {
        invoice: true,
        plan: { include: { goal: { include: { supplier: true } } } },
        approvals: { where: { decision: 'PENDING' }, select: { id: true }, take: 1 },
      },
    });
    const offers: ClientOffer[] = [];
    for (const deal of deals) {
      const open = !isFinal(deal.state) && deal.state !== 'SUGGESTED' && deal.state !== 'APPROVED';
      if (query.status === 'OPEN' && !open) continue;
      if (query.status === 'CLOSED' && open) continue;
      const wire = NegotiationTerms.safeParse(deal.agreedTerms ?? deal.currentTerms);
      if (!wire.success) continue; // nothing offered yet
      const terms = wireToTerms(wire.data);
      const dueDate = dateToIso(deal.invoice.dueDate);
      const daysEarly = diffDays(dueDate, terms.payBy);
      if (daysEarly < 1) continue;
      const ctx = policy === null ? null : (await s.engine.load(s.db, deal.id)).clientView;
      const move = ctx === null ? null : clientMove(ctx, terms, Math.max(1, deal.round));
      offers.push({
        dealId: deal.id,
        supplier: businessRef(deal.plan.goal.supplier),
        invoice: {
          id: deal.invoiceId,
          number: deal.invoice.number,
          amount: money(deal.invoice.amountCents),
          dueDate,
        },
        state: deal.state,
        terms: wire.data,
        payNow: fromCents(paymentFor(terms.amountEarly, terms.discountBps)),
        discountAmount: fromCents(discountOn(terms.amountEarly, terms.discountBps)),
        daysEarly,
        impliedAnnualRate: impliedAnnualRate(percentToBps(wire.data.discountPct), daysEarly),
        policyChecks: ctx === null ? [] : clientChecks(ctx, terms, Math.max(1, deal.round)),
        recommendation:
          move === null
            ? 'NEEDS_HUMAN'
            : move.type === 'ACCEPT'
              ? move.needsHumanApproval
                ? 'NEEDS_HUMAN'
                : 'ACCEPT'
              : move.type,
        round: Math.max(1, deal.round),
        expiresAt: deal.expiresAt?.toISOString() ?? null,
        pendingApprovalId: deal.approvals[0]?.id ?? null,
        updatedAt: deal.updatedAt.toISOString(),
      });
    }
    // Ranked by annualised return, best first.
    offers.sort((a, b) => Number(b.impliedAnnualRate) - Number(a.impliedAnnualRate));
    const cash = policy?.cashOnHandCents ?? 0n;
    const buffer = policy?.cashBufferCents ?? 0n;
    return {
      offers,
      cashPosition: {
        available: money(cash),
        buffer: money(buffer),
        spendableEarly: money(cash > buffer ? cash - buffer : 0n),
        asOf: (policy?.cashAsOf ?? s.now()).toISOString(),
      },
    };
  });

  // ---------------------------------------------------------------- saved PayPal method

  route(router, s.sessions, endpoints.getClientVault, async ({ session }) => ({
    vault: vaultView(await currentVault(session.businessId)),
  }));

  route(router, s.sessions, endpoints.clientVaultSetup, async ({ session }) => {
    const view = await needPayPal().vault.startSetup(session.businessId);
    if (view.status === 'ACTIVE' || view.approveUrl === null) {
      throw conflict('Your PayPal method is already saved');
    }
    const row = await s.db.vaultToken.findUniqueOrThrow({ where: { id: view.vaultTokenId } });
    if (row.setupTokenId === null) throw conflict('PayPal did not return a setup token');
    return { setupTokenId: row.setupTokenId, approvalUrl: view.approveUrl };
  });

  route(router, s.sessions, endpoints.clientVaultConfirm, async ({ body, session }) => {
    const pending = await s.db.vaultToken.findFirst({
      where: { clientId: session.businessId, status: 'PENDING', setupTokenId: body.setupTokenId },
    });
    if (pending === null) throw conflict('No such setup in progress');
    await needPayPal().vault.completeSetup(session.businessId);
    // Deals waiting for this client's payment can now proceed.
    const waiting = await s.db.deal.findMany({
      where: { clientId: session.businessId, state: 'AWAITING_PAYMENT' },
      select: { planId: true },
    });
    for (const planId of new Set(waiting.map((d) => d.planId))) s.runner.kick(planId);
    return { vault: vaultView(await currentVault(session.businessId)) };
  });

  // ---------------------------------------------------------------- PayPal webhooks

  route(router, s.sessions, endpoints.paypalWebhook, async ({ req }) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const headers: WebhookHeaders = {};
    for (const name of PAYPAL_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const outcome = await needPayPal().webhooks.receive(raw, headers);
    const owners = (
      await s.db.business.findMany({ where: { role: 'SUPPLIER' }, select: { id: true } })
    ).map((b) => b.id);
    await s.events.publish(owners, {
      type: 'webhook.received',
      data: {
        paypalEventId: outcome.eventId,
        eventType: outcome.type,
        verified: outcome.status !== 'rejected',
        duplicate: outcome.status === 'duplicate',
      },
    });
    if (outcome.status === 'rejected') {
      throw new AppError('UNAUTHENTICATED', 'Webhook signature did not verify');
    }
    if (outcome.status === 'processed' && outcome.dealId !== null) {
      await s.publishDeals([outcome.dealId]);
      const deal = await s.db.deal.findUniqueOrThrow({
        where: { id: outcome.dealId },
        select: { planId: true },
      });
      s.runner.kick(deal.planId); // the stop rule may now apply
    }
    return { received: true as const, duplicate: outcome.status === 'duplicate' };
  });
}
