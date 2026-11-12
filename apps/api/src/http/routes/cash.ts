/** The Connect screen, the PayPal import, the cash runway and the Cash Studio turn. */
import { type BalanceView, endpoints, isoDateInTimeZone } from '@terms/shared';
import { type Router } from 'express';
import { AiRoleError } from '../../ai/runner.js';
import { runwayFor } from '../../cash/runway-view.js';
import { AppError } from '../../errors.js';
import { type PayPalAccount } from '../../generated/prisma/client.js';
import { money } from '../../mappers.js';
import { type PayPalServices, type Services } from '../../services.js';
import { studioData } from '../studio-data.js';
import { rateLimit } from '../rate-limit.js';
import { route } from '../route.js';

const OPEN_INVOICE = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED', 'PAYMENT_PENDING'] as const;

function balanceView(account: PayPalAccount | null): BalanceView | null {
  const cents = account?.balanceCents ?? null;
  const asOf = account?.balanceAsOf ?? null;
  if (account === null || cents === null || asOf === null) return null;
  return {
    available: money(cents),
    currency: account.balanceCurrency,
    source: account.balanceSource ?? 'PAYPAL_BALANCES',
    asOf: asOf.toISOString(),
  };
}

export function registerCashRoutes(router: Router, s: Services): void {
  const needPayPal = (): PayPalServices => {
    if (s.paypal === null) throw new AppError('NOT_CONFIGURED', 'PayPal is not configured');
    return s.paypal;
  };

  route(router, s.sessions, endpoints.getConnection, async ({ session }) => {
    const supplierId = session.businessId;
    const [account, open, all, transactions] = await Promise.all([
      s.db.payPalAccount.findUnique({ where: { businessId: supplierId } }),
      s.db.invoice.count({ where: { supplierId, paypalStatus: { in: [...OPEN_INVOICE] } } }),
      s.db.invoice.count({ where: { supplierId } }),
      s.db.cashEvent.count({ where: { businessId: supplierId, source: 'PAYPAL_TXN' } }),
    ]);
    return {
      paypal: {
        environment: s.config.paypal.environment,
        connected: s.config.paypal.configured,
        merchantId: account?.merchantId ?? session.business.paypalMerchantId,
        accountEmail: session.business.paypalEmail,
      },
      lastSyncedAt: account?.lastSyncedAt?.toISOString() ?? null,
      counts: { openInvoices: open, allInvoices: all, transactions },
      balance: balanceView(account),
      demo: session.business.isDemo,
    };
  });

  route(router, s.sessions, endpoints.sync, async ({ session }) => {
    const result = await needPayPal().sync.sync(session.businessId);
    const sync = {
      syncedAt: result.syncedAt.toISOString(),
      invoices: result.invoices,
      transactions: {
        imported: result.transactions.imported,
        total: result.transactions.total,
        coveredFrom: result.transactions.coveredFrom?.toISOString() ?? null,
        coveredTo: result.transactions.coveredTo?.toISOString() ?? null,
      },
      balance: {
        available: money(result.balance.availableCents),
        currency: result.balance.currency,
        source: result.balance.source,
        asOf: result.balance.asOf.toISOString(),
      },
    };
    await s.events.publish([session.businessId], { type: 'sync.completed', data: { sync } });
    return sync;
  });

  route(router, s.sessions, endpoints.getRunway, ({ query, session }) =>
    runwayFor(s, { id: session.businessId, timeZone: session.business.timeZone }, query),
  );

  // The Cash Studio strategist runs on the LLM (CONTEXT.md, AI architecture). Rate-limited.
  router.use('/api/studio', rateLimit({ windowMs: 60_000, max: 20 }));
  route(router, s.sessions, endpoints.studioTurn, async ({ body, session }) => {
    if (s.studio === null) {
      throw new AppError(
        'NOT_CONFIGURED',
        'The Cash Studio agent needs an AI provider: set LLM_API_KEY',
      );
    }
    const supplier = { id: session.businessId, timeZone: session.business.timeZone };
    let response;
    try {
      response = await s.studio.turn(body, studioData(s, supplier), {
        businessName: session.business.name,
        today: isoDateInTimeZone(s.now(), supplier.timeZone),
      });
    } catch (err) {
      if (!(err instanceof AiRoleError)) throw err;
      throw new AppError(
        'AI_ERROR',
        'The Cash Studio agent could not answer just now; please try again',
      );
    }
    await s.audit.write(s.db, {
      actor: 'OWNER',
      action: 'STUDIO_TURN',
      subjectType: 'BUSINESS',
      subjectId: supplier.id,
      businessIds: [supplier.id],
      summary: `Cash Studio turn: ${String(response.serverToolCalls.length)} data lookups, ${String(response.message.toolCalls.length)} screen actions`,
      details: {
        messages: body.messages.length,
        dataTools: response.serverToolCalls.map((t) => t.name),
        screenTools: response.message.toolCalls.map((t) => t.name),
      },
    });
    return response;
  });
}
