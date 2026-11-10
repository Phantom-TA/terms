/** The Connect screen, the PayPal import, the cash runway and the Cash Studio turn. */
import {
  type BalanceView,
  endpoints,
  isoDateInTimeZone,
  NegotiationTerms,
  toCents,
} from '@terms/shared';
import { type Router } from 'express';
import { computeRunway, type RunwayDeal, type RunwayFlow } from '../../cash/runway.js';
import { AppError, notFound } from '../../errors.js';
import { type PayPalAccount } from '../../generated/prisma/client.js';
import { dateToIso, money } from '../../mappers.js';
import { type PayPalServices, type Services } from '../../services.js';
import { rateLimit } from '../rate-limit.js';
import { route } from '../route.js';

const OPEN_INVOICE = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED', 'PAYMENT_PENDING'] as const;
const COMMITTED = ['AGREED', 'INVOICE_UPDATED', 'AWAITING_PAYMENT'] as const;
const OPEN_DEAL = ['APPROVED', 'SENT', 'COUNTERED', 'NEEDS_OWNER'] as const;

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

  route(router, s.sessions, endpoints.getRunway, async ({ query, session }) => {
    const supplierId = session.businessId;
    const account = await s.db.payPalAccount.findUnique({ where: { businessId: supplierId } });
    const balanceCents = account?.balanceCents ?? null;
    const balanceAsOf = account?.balanceAsOf ?? null;
    if (account === null || balanceCents === null || balanceAsOf === null) {
      throw new AppError(
        'CONFLICT',
        'Import from PayPal first: the runway starts from your PayPal balance',
      );
    }
    const today = isoDateInTimeZone(s.now(), session.business.timeZone);
    const current = await s.goals.current(supplierId);
    let planId = query.planId ?? current?.planId ?? null;
    if (query.planId !== undefined) {
      const owned = await s.db.plan.findUnique({
        where: { id: query.planId },
        select: { goal: { select: { supplierId: true } } },
      });
      if (owned?.goal.supplierId !== supplierId) throw notFound('Plan');
      planId = query.planId;
    }
    const plan = planId === null ? null : await s.plans.getView(planId, supplierId);
    const goal =
      planId === null
        ? null
        : await s.db.goal.findFirst({ where: { plans: { some: { id: planId } } } });

    const recurring = await s.db.cashEvent.findMany({
      where: {
        businessId: supplierId,
        source: 'CONFIRMED_RECURRING',
        date: { gte: new Date(`${today}T00:00:00Z`) },
      },
    });
    const flows: RunwayFlow[] = recurring.map((f) => ({
      date: dateToIso(f.date),
      amountCents: f.direction === 'IN' ? f.amountCents : -f.amountCents,
      kind: f.kind,
      label: f.label,
    }));

    const rows =
      planId === null
        ? []
        : await s.db.deal.findMany({ where: { planId }, include: { invoice: true, client: true } });
    const deals: RunwayDeal[] = [];
    let confirmedSince = 0n;
    for (const d of rows) {
      const terms = NegotiationTerms.safeParse(d.agreedTerms ?? d.currentTerms);
      const payBy = terms.success ? terms.data.payBy : today;
      const label = `${d.client.name}, invoice ${d.invoice.number}`;
      if (d.action === 'REMINDER') {
        if (d.state !== 'PAID' && d.state !== 'WITHDRAWN' && d.state !== 'FAILED') {
          deals.push({
            date: dateToIso(d.invoice.dueDate),
            amountCents: d.invoice.amountDueCents,
            stage: 'REMINDER',
            label,
          });
        }
      } else if (d.state === 'PAID' || d.state === 'PARTIALLY_PAID') {
        deals.push({ date: payBy, amountCents: d.committedCents, stage: 'PAID', label });
        // PayPal's balance lags (spike S4): add what PayPal confirmed after its timestamp.
        if (d.updatedAt > balanceAsOf) confirmedSince += d.committedCents;
      } else if ((COMMITTED as readonly string[]).includes(d.state)) {
        deals.push({ date: payBy, amountCents: d.committedCents, stage: 'COMMITTED', label });
      } else if ((OPEN_DEAL as readonly string[]).includes(d.state)) {
        deals.push({ date: payBy, amountCents: d.committedCents, stage: 'OPEN', label });
      }
    }

    return computeRunway({
      today,
      horizonDays: query.horizonDays,
      balanceCents,
      balanceAsOf,
      confirmedSinceCents: confirmedSince,
      currency: account.balanceCurrency,
      planId,
      deadline: goal === null ? null : dateToIso(goal.deadline),
      gapCents: goal?.amountCents ?? 0n,
      committedCents: plan === null ? 0n : toCents(plan.summary.committed),
      bestEffortCents: plan === null ? 0n : toCents(plan.summary.bestEffort),
      flows,
      deals,
    });
  });

  // The Cash Studio strategist runs on the LLM (CONTEXT.md, AI architecture). Rate-limited.
  router.use('/api/studio', rateLimit({ windowMs: 60_000, max: 20 }));
  route(router, s.sessions, endpoints.studioTurn, () => {
    throw new AppError(
      'NOT_CONFIGURED',
      s.config.llm.configured
        ? 'The Cash Studio agent is not available yet'
        : 'The Cash Studio agent needs an AI provider: set LLM_API_KEY',
    );
  });
}
