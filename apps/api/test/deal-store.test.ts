import { dollars, IllegalTransitionError } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../src/audit.js';
import { DealStore } from '../src/deals/deal-store.js';
import { AppError } from '../src/errors.js';
import { createTestDb, resetDb } from './helpers/db.js';
import { seedDeal, seedScenario } from './helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const store = new DealStore(db, audit);

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const terms = {
  amountEarly: '1750.00',
  discountPct: '1.20',
  payBy: '2026-11-09',
  remainderDue: '2026-12-03',
};

describe('DealStore (Postgres)', () => {
  it('walks Harbor through the scenario path with history, audit and listeners', async () => {
    const ids = await seedScenario(db);
    const { deal } = await seedDeal(db, ids);
    const seen: string[] = [];
    store.onTransition((d, from) => seen.push(`${from}->${d.state}`));

    await store.transition({
      dealId: deal.id,
      to: 'APPROVED',
      actor: 'OWNER',
      reason: 'Plan approved',
    });
    await store.transition({
      dealId: deal.id,
      to: 'SENT',
      actor: 'SUPPLIER_AGENT',
      reason: 'Offer sent at 0.80%',
      patch: { round: 1, currentTerms: { ...terms, discountPct: '0.80' } },
    });
    await store.transition({
      dealId: deal.id,
      to: 'COUNTERED',
      actor: 'CLIENT_AGENT',
      reason: '0.80% is below our 15% hurdle; counter at 1.50%',
    });
    await store.transition({
      dealId: deal.id,
      to: 'NEEDS_OWNER',
      actor: 'SUPPLIER_AGENT',
      reason: 'Counter at 1.20% would take plan cost $1 over the ceiling',
    });
    await store.transition({
      dealId: deal.id,
      to: 'SENT',
      actor: 'OWNER',
      reason: 'Owner approved the 1.20% counter',
      patch: { round: 2, currentTerms: terms },
    });
    const agreed = await store.transition({
      dealId: deal.id,
      to: 'AGREED',
      actor: 'CLIENT_AGENT',
      reason: 'Accepted 1.20% (18.5% a year)',
      patch: { agreedTerms: terms, costCents: dollars(21), committedCents: dollars(1729) },
    });

    expect(agreed.state).toBe('AGREED');
    expect(agreed.version).toBe(6);
    expect(agreed.round).toBe(2);
    expect(agreed.agreedTerms).toEqual(terms);
    expect(seen).toEqual([
      'SUGGESTED->APPROVED',
      'APPROVED->SENT',
      'SENT->COUNTERED',
      'COUNTERED->NEEDS_OWNER',
      'NEEDS_OWNER->SENT',
      'SENT->AGREED',
    ]);

    const history = await db.dealTransition.findMany({
      where: { dealId: deal.id },
      orderBy: { at: 'asc' },
    });
    expect(history.map((h) => h.toState)).toEqual([
      'APPROVED',
      'SENT',
      'COUNTERED',
      'NEEDS_OWNER',
      'SENT',
      'AGREED',
    ]);
    const harborAudit = await audit.list(db, ids.harbor, { limit: 50 });
    expect(harborAudit.entries).toHaveLength(6);
    expect(harborAudit.entries[0]!.summary).toBe('SENT → AGREED: Accepted 1.20% (18.5% a year)');
  });

  it('counts only agreed or paid deals as committed', async () => {
    const ids = await seedScenario(db);
    const { deal, plan } = await seedDeal(db, ids);
    expect(await store.committedForPlan(db, plan.id)).toEqual({ committed: 0n, cost: 0n });
    await store.transition({ dealId: deal.id, to: 'APPROVED', actor: 'OWNER', reason: 'ok' });
    await store.transition({ dealId: deal.id, to: 'SENT', actor: 'SUPPLIER_AGENT', reason: 'ok' });
    expect((await store.committedForPlan(db, plan.id)).committed).toBe(0n);
    await store.transition({
      dealId: deal.id,
      to: 'AGREED',
      actor: 'CLIENT_AGENT',
      reason: 'ok',
      patch: { committedCents: dollars(1729), costCents: dollars(21) },
    });
    expect(await store.committedForPlan(db, plan.id)).toEqual({
      committed: dollars(1729),
      cost: dollars(21),
    });
    await store.transition({
      dealId: deal.id,
      to: 'FAILED',
      actor: 'SYSTEM',
      reason: 'PayPal rejected update',
    });
    expect((await store.committedForPlan(db, plan.id)).committed).toBe(0n);
    const failed = await store.get(db, deal.id);
    expect(failed.closedReason).toBe('PayPal rejected update');
  });

  it('rejects illegal transitions and payment states from anyone but PayPal', async () => {
    const ids = await seedScenario(db);
    const { deal } = await seedDeal(db, ids);
    await expect(
      store.transition({
        dealId: deal.id,
        to: 'SENT',
        actor: 'SUPPLIER_AGENT',
        reason: 'skip approval',
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(
      store.transition({
        dealId: deal.id,
        to: 'PAID',
        actor: 'CLIENT_AGENT',
        reason: 'says it paid',
      }),
    ).rejects.toThrow('CLIENT_AGENT may not move a deal from SUGGESTED to PAID');
    const paid = await store.transition({
      dealId: deal.id,
      to: 'PAID',
      actor: 'PAYPAL',
      reason: 'INVOICING.INVOICE.PAID verified',
    });
    expect(paid.state).toBe('PAID');
    expect(await db.dealTransition.count({ where: { dealId: deal.id } })).toBe(1);
  });

  it('detects concurrent changes with the version lock', async () => {
    const ids = await seedScenario(db);
    const { deal } = await seedDeal(db, ids);
    await expect(
      store.transition({
        dealId: deal.id,
        to: 'APPROVED',
        actor: 'OWNER',
        reason: 'stale',
        expectedVersion: 5,
      }),
    ).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'CONFLICT');
    await expect(
      store.transition({ dealId: 'missing', to: 'APPROVED', actor: 'OWNER', reason: 'x' }),
    ).rejects.toSatisfy((e) => e instanceof AppError && e.code === 'NOT_FOUND');
  });

  it('runs inside a caller transaction and clears JSON terms', async () => {
    const ids = await seedScenario(db);
    const { deal } = await seedDeal(db, ids);
    await db.$transaction(async (tx) => {
      await store.transition(
        {
          dealId: deal.id,
          to: 'APPROVED',
          actor: 'OWNER',
          reason: 'ok',
          patch: { currentTerms: terms },
        },
        tx,
      );
      await store.transition(
        {
          dealId: deal.id,
          to: 'WITHDRAWN',
          actor: 'SYSTEM',
          reason: 'Goal met',
          patch: {
            currentTerms: null,
            agreedTerms: null,
            expiresAt: null,
            closedReason: 'Goal met before sending',
            reissuedInvoiceId: null,
            paypalOrderId: null,
            paypalCaptureId: null,
            invoicePaymentId: null,
            payerUrl: null,
          },
        },
        tx,
      );
    });
    const after = await store.get(db, deal.id);
    expect(after.state).toBe('WITHDRAWN');
    expect(after.currentTerms).toBeNull();
    expect(after.closedReason).toBe('Goal met before sending');
  });
});
