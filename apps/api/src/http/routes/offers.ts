/**
 * The public offer page for a person at a client without an agent (CONTEXT.md, screen 7). The link
 * itself is the credential (a signed, expiring token); replies are buttons. Free-text replies need
 * the reply parser, which runs on the LLM: without a key they are refused honestly.
 */
import {
  diffDays,
  discountOn,
  endpoints,
  fromCents,
  impliedAnnualRate,
  NegotiationTerms,
  paymentFor,
  type PublicOffer,
  toCents,
} from '@terms/shared';
import { type Router } from 'express';
import { AppError } from '../../errors.js';
import { type Deal } from '../../generated/prisma/client.js';
import { dateToIso, money } from '../../mappers.js';
import { wireToTerms } from '../../negotiation/engine.js';
import { PARTIAL_STEP } from '../../negotiation/strategies.js';
import { type Services } from '../../services.js';
import { rateLimit } from '../rate-limit.js';
import { route } from '../route.js';

function pageState(state: Deal['state']): PublicOffer['state'] {
  switch (state) {
    case 'SENT':
      return 'OPEN';
    case 'COUNTERED':
    case 'NEEDS_OWNER':
      return 'COUNTERED';
    case 'AGREED':
    case 'INVOICE_UPDATED':
    case 'AWAITING_PAYMENT':
      return 'ACCEPTED';
    case 'PAID':
    case 'PARTIALLY_PAID':
      return 'PAID';
    case 'DECLINED':
      return 'DECLINED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'WITHDRAWN';
  }
}

export function registerOfferRoutes(router: Router, s: Services): void {
  // A person opens a link a few times; anything more is a script.
  router.use('/api/offer', rateLimit({ windowMs: 60_000, max: 30 }));

  const publicOffer = async (dealId: string): Promise<PublicOffer> => {
    const deal = await s.db.deal.findUniqueOrThrow({
      where: { id: dealId },
      include: {
        invoice: true,
        client: true,
        plan: { include: { goal: { include: { supplier: true } } } },
      },
    });
    const wire = NegotiationTerms.parse(deal.agreedTerms ?? deal.currentTerms);
    const terms = wireToTerms(wire);
    const dueDate = dateToIso(deal.invoice.dueDate);
    const days = Math.max(1, diffDays(dueDate, terms.payBy));
    const lastNote = await s.db.negotiationMessage.findFirst({
      where: { dealId, fromParty: { startsWith: 'supplier:' } },
      orderBy: { createdAt: 'desc' },
    });
    const state = pageState(deal.state);
    return {
      supplierName: deal.plan.goal.supplier.name,
      clientName: deal.client.name,
      invoiceNumber: deal.invoice.number,
      invoiceAmount: money(deal.invoice.amountCents),
      currency: deal.invoice.currency,
      originalDueDate: dueDate,
      terms: wire,
      payNow: fromCents(paymentFor(terms.amountEarly, terms.discountBps)),
      discountAmount: fromCents(discountOn(terms.amountEarly, terms.discountBps)),
      impliedAnnualRate: impliedAnnualRate(terms.discountBps, days),
      allowPartial: state === 'OPEN' && terms.amountEarly > PARTIAL_STEP,
      minPartial: state === 'OPEN' && terms.amountEarly > PARTIAL_STEP ? money(PARTIAL_STEP) : null,
      state,
      // Once the invoice carries the agreed terms, the person pays it on PayPal.
      payUrl: state === 'ACCEPTED' ? deal.payerUrl : null,
      expiresAt: (deal.expiresAt ?? s.now()).toISOString(),
      note: lastNote?.note ?? '',
      demo: deal.plan.goal.supplier.isDemo,
    };
  };

  route(router, s.sessions, endpoints.getPublicOffer, async ({ params }) => {
    const deal = await s.offerTokens.open(s.db, params['token'] ?? '');
    const offer = await publicOffer(deal.id);
    await s.audit.write(s.db, {
      actor: 'CLIENT_HUMAN',
      action: 'OFFER_PAGE_VIEWED',
      subjectType: 'DEAL',
      subjectId: deal.id,
      businessIds: [deal.clientId],
      summary: `Offer page opened for invoice ${offer.invoiceNumber}`,
    });
    return { offer };
  });

  route(router, s.sessions, endpoints.replyPublicOffer, async ({ params, body }) => {
    const deal = await s.offerTokens.open(s.db, params['token'] ?? '');
    if (body.kind === 'TEXT') {
      throw new AppError(
        'NOT_CONFIGURED',
        'Written replies are not available yet; please use the buttons on this page',
      );
    }
    if (body.kind === 'PAY_PART') {
      const amount = toCents(body.amountEarly);
      if (amount < PARTIAL_STEP) {
        throw new AppError(
          'VALIDATION_FAILED',
          `The smallest early payment is ${money(PARTIAL_STEP)}`,
          {
            issues: [{ path: 'amountEarly', message: 'Too small' }],
          },
        );
      }
      await s.engine.humanReply(deal.id, { kind: 'PAY_PART', amountEarly: amount });
    } else {
      await s.engine.humanReply(deal.id, body);
    }
    await s.publishDeals([deal.id]);
    s.runner.kick(deal.planId); // the supplier agent answers a counter; an accept goes to PayPal
    await s.runner.drain();
    const offer = await publicOffer(deal.id);
    const message =
      offer.state === 'ACCEPTED'
        ? offer.payUrl === null
          ? `Thanks. ${offer.supplierName} is updating the invoice; you will pay it on PayPal.`
          : `Thanks. Pay ${offer.payNow} on PayPal to confirm.`
        : offer.state === 'DECLINED'
          ? 'Thanks for letting us know. Nothing changes on your invoice.'
          : offer.state === 'OPEN'
            ? `${offer.supplierName} replied with new terms.`
            : `${offer.supplierName} will reply shortly.`;
    return { offer, message, parsed: null };
  });
}
