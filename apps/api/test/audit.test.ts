import { AuditEntry } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../src/audit.js';
import { createTestDb, resetDb } from './helpers/db.js';

const db = createTestDb();
const audit = new AuditLogger();

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('AuditLogger (Postgres)', () => {
  it('writes an entry and notifies listeners', async () => {
    const seen: string[] = [];
    const off = audit.onAppend((entry, ids) => {
      seen.push(`${entry.action}:${ids.join(',')}`);
    });
    const entry = await audit.write(db, {
      actor: 'SUPPLIER_AGENT',
      action: 'POLICY_CHECKED',
      subjectType: 'DEAL',
      subjectId: 'deal_1',
      businessIds: ['maya', 'harbor', 'maya'],
      summary: 'Policy blocked 1.50%: above the 1.20% maximum',
      details: { checks: [{ rule: 'maxDiscount', result: 'blocked' }], cost: 6100n },
      paypalRequestId: 'deal_1:counter:2',
    });
    off();
    expect(entry.actor).toBe('SUPPLIER_AGENT');
    expect(entry.details).toEqual({
      checks: [{ rule: 'maxDiscount', result: 'blocked' }],
      cost: '6100',
    });
    expect(entry.paypalRequestId).toBe('deal_1:counter:2');
    expect(entry.paypalCall).toBeNull();
    // A DEAL entry belongs to its subject by default.
    expect(entry.dealId).toBe('deal_1');
    expect(AuditEntry.safeParse(entry).success).toBe(true);
    expect(seen).toEqual(['POLICY_CHECKED:maya,harbor']);
  });

  it('records the PayPal call and finds every entry of a deal, whatever its subject', async () => {
    await audit.write(db, {
      actor: 'SYSTEM',
      action: 'PAYPAL_REQUEST',
      subjectType: 'INVOICE',
      subjectId: 'inv_1',
      dealId: 'deal_7',
      businessIds: ['maya', 'harbor'],
      summary: 'Invoice 1043 updated: 1.20% off $1,750.00',
      paypalCall: 'PUT /v2/invoicing/invoices/{id}',
      paypalRequestId: 'deal_7:update:1',
    });
    await audit.write(db, {
      actor: 'OWNER',
      action: 'DEAL_TRANSITION',
      subjectType: 'DEAL',
      subjectId: 'deal_7',
      businessIds: ['maya'],
      summary: 'Approved',
    });
    await audit.write(db, {
      actor: 'SYSTEM',
      action: 'PLAN_CREATED',
      subjectType: 'PLAN',
      subjectId: 'plan_1',
      businessIds: ['maya'],
      summary: 'Plan created',
    });
    const forDeal = await audit.list(db, 'maya', { limit: 50, dealId: 'deal_7' });
    expect(forDeal.entries.map((e) => [e.subjectType, e.paypalCall])).toEqual([
      ['DEAL', null],
      ['INVOICE', 'PUT /v2/invoicing/invoices/{id}'],
    ]);
    const plan = await audit.list(db, 'maya', { limit: 50, subjectType: 'PLAN' });
    expect(plan.entries[0]!.dealId).toBeNull();
    // The client sees the PayPal call on its deal, not the owner-only transition.
    const harbor = await audit.list(db, 'harbor', { limit: 50, dealId: 'deal_7' });
    expect(harbor.entries).toHaveLength(1);
  });

  it('never stores secrets or tokens in details', async () => {
    const entry = await audit.write(db, {
      actor: 'SYSTEM',
      action: 'PAYPAL_REQUEST',
      subjectType: 'INVOICE',
      subjectId: 'inv_1',
      businessIds: ['maya'],
      summary: 'Updated invoice',
      details: {
        request: { headers: { Authorization: 'Bearer abc' }, access_token: 'A21AAxyz' },
        client_secret: 'shh',
        offerToken: 'tok',
        invoiceId: 'INV2-1',
      },
    });
    expect(JSON.stringify(entry.details)).not.toMatch(/abc|A21AAxyz|shh|tok"/);
    expect(entry.details).toMatchObject({ invoiceId: 'INV2-1', client_secret: '[redacted]' });
  });

  it('lists only entries visible to the business, newest first, with cursor paging', async () => {
    for (let i = 0; i < 5; i++) {
      await audit.write(db, {
        actor: 'SYSTEM',
        action: 'DEAL_TRANSITION',
        subjectType: 'DEAL',
        subjectId: `deal_${i}`,
        businessIds: i % 2 === 0 ? ['maya', 'harbor'] : ['maya'],
        summary: `step ${i}`,
      });
    }
    const page1 = await audit.list(db, 'maya', { limit: 2 });
    expect(page1.entries.map((e) => e.summary)).toEqual(['step 4', 'step 3']);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await audit.list(db, 'maya', { limit: 2, cursor: page1.nextCursor! });
    expect(page2.entries.map((e) => e.summary)).toEqual(['step 2', 'step 1']);
    const page3 = await audit.list(db, 'maya', { limit: 2, cursor: page2.nextCursor! });
    expect(page3.entries.map((e) => e.summary)).toEqual(['step 0']);
    expect(page3.nextCursor).toBeNull();

    const harbor = await audit.list(db, 'harbor', { limit: 50 });
    expect(harbor.entries.map((e) => e.subjectId)).toEqual(['deal_4', 'deal_2', 'deal_0']);

    const filtered = await audit.list(db, 'maya', { limit: 50, subjectId: 'deal_3' });
    expect(filtered.entries).toHaveLength(1);
    const none = await audit.list(db, 'maya', {
      limit: 50,
      actor: 'PAYPAL',
      action: 'WEBHOOK_VERIFIED',
      subjectType: 'WEBHOOK_EVENT',
    });
    expect(none.entries).toEqual([]);
  });
});
