import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiRoleError } from '../../src/ai/runner.js';
import { forRole, ScriptedRunner } from '../helpers/ai.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { jsonResponse, routePayPal } from '../helpers/fake-fetch.js';
import { type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

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

const txn = (id: string, value: string, code: string, subject: string) => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: code,
    transaction_initiation_date: '2026-10-20T10:00:00+0000',
    transaction_amount: { currency_code: 'USD', value },
    transaction_subject: subject,
  },
});

/** A sandbox with no invoices and four transactions, two of which PayPal's code cannot classify. */
function fakePayPal() {
  let windows = 0;
  return routePayPal({
    'GET /v2/invoicing/invoices': () => jsonResponse(200, { items: [], total_pages: 1 }),
    'GET /v1/reporting/transactions': () => {
      windows += 1;
      return jsonResponse(200, {
        transaction_details:
          windows % 3 === 1
            ? [
                txn('TXN-1', '-45.00', 'T9999', 'Figma monthly'),
                txn('TXN-2', '-2400.00', 'T9999', 'Rent for October'),
                txn('TXN-3', '2500.00', 'T0007', 'Invoice 1035'),
                txn('TXN-4', '-11400.00', 'T0400', 'Payroll'),
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

async function syncWith(runner: ScriptedRunner | null) {
  const { app } = testApp(db, {
    now,
    paypalFetch: fakePayPal().fetch,
    ...(runner === null ? {} : { aiRunner: runner }),
  });
  const maya = request.agent(app);
  await maya.post('/api/session').send({ businessId: ids.maya }).expect(201);
  await maya.post('/api/sync').send({}).expect(200);
}

const events = async (): Promise<Record<string, string[]>> => {
  const out: Record<string, string[]> = {};
  for (const e of await db.cashEvent.findMany()) out[e.paypalTxnId ?? e.id] = [e.kind, e.label];
  return out;
};

describe('labelling imported transactions', () => {
  it('labels only what PayPal’s event code left unclassified, and keeps what fails a check', async () => {
    const runner = forRole('flow-labeller', () => ({
      labels: [
        { index: 0, kind: 'SUBSCRIPTION', label: 'Figma subscription' },
        { index: 1, kind: 'RENT', label: 'Rent for 3 months' }, // invents a figure: dropped
      ],
    }));
    await syncWith(runner);
    expect(await events()).toEqual({
      'TXN-1': ['SUBSCRIPTION', 'Figma subscription'],
      'TXN-2': ['OTHER', 'Rent for October'],
      'TXN-3': ['INVOICE_PAYMENT', 'Invoice 1035'], // classified by code: untouched
      'TXN-4': ['TRANSFER', 'Payroll'],
    });
    const asked = runner.callsTo('flow-labeller');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.prompt).toContain('Figma monthly');
    expect(asked[0]?.prompt).not.toContain('Invoice 1035');
  });

  it('imports everything with PayPal’s own words when the model fails', async () => {
    await syncWith(new ScriptedRunner((c) => new AiRoleError('provider', c.role, 'down')));
    expect(await events()).toEqual({
      'TXN-1': ['OTHER', 'Figma monthly'],
      'TXN-2': ['OTHER', 'Rent for October'],
      'TXN-3': ['INVOICE_PAYMENT', 'Invoice 1035'],
      'TXN-4': ['TRANSFER', 'Payroll'],
    });
  });

  it('does nothing without AI', async () => {
    await syncWith(null);
    expect((await events())['TXN-1']).toEqual(['OTHER', 'Figma monthly']);
  });

  it('never makes a labelled transaction a confirmed recurring flow', async () => {
    await syncWith(
      forRole('flow-labeller', () => ({
        labels: [{ index: 1, kind: 'RENT', label: 'October rent' }],
      })),
    );
    expect(await db.cashEvent.count({ where: { source: 'CONFIRMED_RECURRING' } })).toBe(0);
    expect((await db.cashEvent.findMany()).every((e) => e.source === 'PAYPAL_TXN')).toBe(true);
  });
});
