import {
  ApiErrorBody,
  ConnectionResponse,
  dollars,
  RunwayResponse,
  SyncResponse,
} from '@terms/shared';
import type express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { computeRunway } from '../../src/cash/runway.js';
import { isoToDate } from '../../src/mappers.js';
import { kindOfEvent } from '../../src/paypal/sync-service.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { jsonResponse, routePayPal } from '../helpers/fake-fetch.js';
import { FRIDAY, type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
let ids: ScenarioIds;
const now = () => new Date('2026-11-09T15:00:00Z');

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function signedIn(app: express.Express, businessId: string) {
  const agent = request.agent(app);
  await agent.post('/api/session').send({ businessId }).expect(201);
  return agent;
}

const errorCode = (body: unknown) => ApiErrorBody.parse(body).error.code;

function wireInvoice(
  id: string,
  number: string,
  total: string,
  email: string,
  status = 'SENT',
  business = '',
) {
  return {
    id,
    status,
    detail: {
      invoice_number: number,
      invoice_date: '2026-11-01',
      payment_term: { due_date: '2026-12-01' },
      metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${number}` },
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: email,
          ...(business === '' ? {} : { business_name: business }),
        },
      },
    ],
    amount: { currency_code: 'USD', value: total },
    due_amount: { currency_code: 'USD', value: total },
  };
}

const txn = (id: string, value: string, code: string, subject: string) => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: code,
    transaction_initiation_date: '2026-10-20T10:00:00+0000',
    transaction_amount: { currency_code: 'USD', value },
    transaction_subject: subject,
  },
});

function fakePayPal() {
  let windows = 0;
  return routePayPal({
    'GET /v2/invoicing/invoices': () =>
      jsonResponse(200, {
        items: [{ id: 'INV2-TEST-1043' }, { id: 'INV2-NEW-2001' }, { id: 'INV2-DRAFT-1' }],
        total_pages: 1,
      }),
    'GET /v2/invoicing/invoices/INV2-TEST-1043': () =>
      jsonResponse(
        200,
        wireInvoice('INV2-TEST-1043', '1043', '7500.00', 'harbor@terms-demo.example.com', 'UNPAID'),
      ),
    'GET /v2/invoicing/invoices/INV2-NEW-2001': () =>
      jsonResponse(
        200,
        wireInvoice('INV2-NEW-2001', '2001', '900.00', 'Elm@Example.com', 'SENT', 'Elm Cafe'),
      ),
    'GET /v2/invoicing/invoices/INV2-DRAFT-1': () =>
      jsonResponse(200, wireInvoice('INV2-DRAFT-1', 'D1', '1.00', 'x@example.com', 'DRAFT')),
    'GET /v1/reporting/transactions': () => {
      windows += 1;
      // Only the oldest window holds transactions in this fake.
      return jsonResponse(200, {
        transaction_details:
          windows % 3 === 1
            ? [
                txn('TXN-1', '-11400.00', 'T0400', 'Payroll'),
                txn('TXN-2', '2500.00', 'T0007', 'Invoice 1035'),
                { transaction_info: {} },
              ]
            : [],
        total_pages: 1,
        page: 1,
        last_refreshed_datetime: '2026-11-09T13:29:59Z',
      });
    },
    'GET /v1/reporting/balances': () =>
      jsonResponse(200, {
        balances: [
          {
            currency: 'USD',
            available_balance: { currency_code: 'USD', value: '5200.00' },
            total_balance: { currency_code: 'USD', value: '5200.00' },
          },
        ],
        as_of_time: '2026-11-09T13:29:59Z',
      }),
  });
}

describe('PayPal import (sync) and the Connect screen', () => {
  it('imports invoices, transactions and the balance, once, and reports them', async () => {
    await db.business.update({
      where: { id: ids.harbor },
      data: { paypalEmail: 'harbor@terms-demo.example.com' },
    });
    const paypal = fakePayPal();
    const { app } = testApp(db, { now, paypalFetch: paypal.fetch });
    const maya = await signedIn(app, ids.maya);

    const before = ConnectionResponse.parse((await maya.get('/api/connection').expect(200)).body);
    expect(before).toMatchObject({
      paypal: { environment: 'sandbox', connected: true },
      lastSyncedAt: null,
      counts: { openInvoices: 5, allInvoices: 5, transactions: 0 },
      balance: null,
      demo: true,
    });

    const sync = SyncResponse.parse((await maya.post('/api/sync').send({}).expect(200)).body);
    expect(sync.invoices).toEqual({ imported: 1, updated: 1, unchanged: 0, total: 2 });
    expect(sync.transactions).toMatchObject({
      imported: 2,
      total: 2,
      coveredTo: '2026-11-09T13:29:59.000Z',
    });
    expect(sync.balance).toEqual({
      available: '5200.00',
      currency: 'USD',
      source: 'PAYPAL_BALANCES',
      asOf: '2026-11-09T13:29:59.000Z',
    });

    // The new recipient became a client; the known one was matched by email.
    const elm = await db.business.findFirstOrThrow({ where: { name: 'Elm Cafe' } });
    expect(elm).toMatchObject({ role: 'CLIENT', paypalEmail: 'elm@example.com', slug: 'elm-cafe' });
    const harborInvoice = await db.invoice.findUniqueOrThrow({
      where: { paypalInvoiceId: 'INV2-TEST-1043' },
    });
    expect(harborInvoice).toMatchObject({ clientId: ids.harbor, paypalStatus: 'UNPAID' });
    // Transaction Search was walked in 31-day windows (90 days → 3 queries).
    expect(
      paypal.apiCalls().filter((c) => c.url.pathname === '/v1/reporting/transactions'),
    ).toHaveLength(3);
    const window = new URL(
      paypal.apiCalls().find((c) => c.url.pathname === '/v1/reporting/transactions')!.url,
    );
    const span =
      (Date.parse(window.searchParams.get('end_date')!) -
        Date.parse(window.searchParams.get('start_date')!)) /
      86_400_000;
    expect(span).toBeLessThanOrEqual(31);
    const events = await db.cashEvent.findMany({ orderBy: { paypalTxnId: 'asc' } });
    expect(events.map((e) => [e.paypalTxnId, e.direction, e.kind, e.amountCents])).toEqual([
      ['TXN-1', 'OUT', 'TRANSFER', dollars(11400)],
      ['TXN-2', 'IN', 'INVOICE_PAYMENT', dollars(2500)],
    ]);

    // A second sync imports nothing twice.
    const again = SyncResponse.parse((await maya.post('/api/sync').send({}).expect(200)).body);
    expect(again.invoices).toEqual({ imported: 0, updated: 0, unchanged: 2, total: 2 });
    expect(again.transactions.imported).toBe(0);
    expect(await db.cashEvent.count()).toBe(2);

    const after = ConnectionResponse.parse((await maya.get('/api/connection').expect(200)).body);
    expect(after).toMatchObject({
      counts: { openInvoices: 6, allInvoices: 6, transactions: 2 },
      balance: { available: '5200.00' },
    });
    expect(
      await db.eventLog.count({ where: { businessId: ids.maya, type: 'sync.completed' } }),
    ).toBe(2);
  });

  it('needs PayPal to sync, and a supplier session', async () => {
    const { app } = testApp(db, { now, noPayPal: true });
    const maya = await signedIn(app, ids.maya);
    expect(errorCode((await maya.post('/api/sync').send({}).expect(503)).body)).toBe(
      'NOT_CONFIGURED',
    );
    expect(
      ConnectionResponse.parse((await maya.get('/api/connection').expect(200)).body).paypal
        .connected,
    ).toBe(false);
    const harbor = await signedIn(app, ids.harbor);
    await harbor.get('/api/connection').expect(403);
  });

  it('reports PayPal failures during sync as API errors', async () => {
    const paypal = routePayPal({
      'GET /v2/invoicing/invoices': () => jsonResponse(500, { name: 'INTERNAL_SERVER_ERROR' }),
    });
    const { app } = testApp(db, { now, paypalFetch: paypal.fetch });
    const maya = await signedIn(app, ids.maya);
    expect(errorCode((await maya.post('/api/sync').send({}).expect(502)).body)).toBe(
      'PAYPAL_ERROR',
    );
  });
});

describe('cash runway', () => {
  it('starts from the PayPal balance, with the payroll line, before and after the plan', async () => {
    const { app, services } = testApp(db, { now, noPayPal: true });
    const maya = await signedIn(app, ids.maya);
    expect(errorCode((await maya.get('/api/runway').expect(409)).body)).toBe('CONFLICT');

    await db.payPalAccount.create({
      data: {
        businessId: ids.maya,
        balanceCents: dollars(5200),
        balanceSource: 'PAYPAL_BALANCES',
        balanceAsOf: new Date('2026-11-09T13:29:59Z'),
      },
    });
    await db.cashEvent.create({
      data: {
        businessId: ids.maya,
        date: isoToDate(FRIDAY),
        amountCents: dollars(11400),
        direction: 'OUT',
        kind: 'PAYROLL',
        source: 'CONFIRMED_RECURRING',
        label: 'Payroll',
      },
    });
    const goal = await db.goal.create({
      data: {
        supplierId: ids.maya,
        rawText: 'demo',
        amountCents: dollars(6200),
        deadline: isoToDate(FRIDAY),
        maxDiscountBps: 120,
        openingDiscountBps: 80,
        doNotContactIds: [ids.pinecrest, ids.birch],
        bufferBps: 500,
        status: 'DRAFT',
      },
    });
    const planId = await services.plans.createPlan(goal.id);
    await services.plans.approve(planId, ids.maya, dollars(60));
    services.runner.kick(planId);
    await services.runner.drain(); // Juniper AGREED, Harbor NEEDS_OWNER, Oak's reminder waits for PayPal

    const runway = RunwayResponse.parse(
      (await maya.get('/api/runway?horizonDays=7').expect(200)).body,
    );
    expect(runway).toMatchObject({
      today: '2026-11-09',
      balance: '5200.00',
      planId,
      deadline: FRIDAY,
      gap: '6200.00',
      committed: '4960.00',
      bestEffort: '1800.00',
      thresholds: [{ label: 'Payroll $11,400.00', amount: '11400.00', date: FRIDAY }],
    });
    expect(runway.points).toHaveLength(8);
    const friday = runway.points.find((p) => p.date === FRIDAY)!;
    expect(friday).toEqual({
      date: FRIDAY,
      before: '-6200.00', // $5,200 − $11,400: the gap
      afterCommitted: '-1240.00', // + Juniper's $4,960
      afterPlanned: '496.00', // + Harbor's $1,736 if accepted at the plan's 0.8%
      afterBestEffort: '2296.00', // + Oak Street's $1,800 if the reminder works
    });
    expect(runway.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['PAYROLL', 'DEAL_COMMITTED', 'INVOICE_DUE']),
    );
    await maya.get('/api/runway?horizonDays=3').expect(400);
  });

  it('adds payments PayPal confirmed after its balance timestamp', () => {
    const r = computeRunway({
      today: '2026-11-09',
      horizonDays: 7,
      balanceCents: dollars(5200),
      balanceAsOf: new Date('2026-11-09T13:29:59Z'),
      confirmedSinceCents: dollars(1729),
      currency: 'USD',
      planId: null,
      deadline: null,
      gapCents: 0n,
      committedCents: 0n,
      bestEffortCents: 0n,
      flows: [
        { date: '2026-12-31', amountCents: -dollars(1), kind: 'RENT', label: 'beyond the horizon' },
      ],
      deals: [{ date: '2026-11-01', amountCents: dollars(1729), stage: 'PAID', label: 'Harbor' }],
    });
    expect(r.balance).toBe('6929.00');
    expect(r.points[0]).toMatchObject({ before: '6929.00', afterBestEffort: '6929.00' });
    expect(r.events).toEqual([
      {
        date: '2026-11-09',
        amount: '1729.00',
        kind: 'DEAL_PAID',
        label: 'Harbor',
        committed: true,
      },
    ]);
    expect(r.thresholds).toEqual([]);
  });

  it('classifies PayPal event codes', () => {
    expect(kindOfEvent('T0007', 100n)).toBe('INVOICE_PAYMENT');
    expect(kindOfEvent('T0006', -100n)).toBe('OTHER');
    expect(kindOfEvent('T0500', -100n)).toBe('TRANSFER');
    expect(kindOfEvent('T9999', 1n)).toBe('OTHER');
    expect(kindOfEvent(undefined, 1n)).toBe('OTHER');
  });

  it('answers the Cash Studio turn honestly until the AI provider is set', async () => {
    const { app } = testApp(db, { now, noPayPal: true });
    const maya = await signedIn(app, ids.maya);
    const res = await maya
      .post('/api/studio/turn')
      .send({ messages: [{ role: 'user', content: 'What if Juniper pays late?' }] })
      .expect(503);
    expect(ApiErrorBody.parse(res.body).error).toMatchObject({
      code: 'NOT_CONFIGURED',
      message: expect.stringContaining('LLM_API_KEY') as string,
    });
  });
});
