import { dollars } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_INVOICES,
  DemoSeed,
  SCALE_CLIENTS,
  SCALE_INVOICES,
} from '../../src/seed/demo-seed.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { jsonResponse, paypalError, stubFetch, tokenResponse } from '../helpers/fake-fetch.js';

const db = createTestDb();
// Monday 9 November, 10:00 in New York.
const now = () => new Date('2026-11-09T15:00:00Z');

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

/** A fake PayPal account that keeps the invoices it is asked to create, like the sandbox does. */
function fakeSandbox(options: { duplicateNumbers?: boolean; stray?: string[] } = {}) {
  const invoices = new Map<string, Record<string, unknown>>();
  const payments: { id: string; body: unknown }[] = [];
  for (const entry of options.stray ?? []) {
    const [id = entry, status = 'SENT'] = entry.split(':');
    invoices.set(id, {
      id,
      status,
      detail: { invoice_number: id },
      amount: { currency_code: 'USD', value: '10.00' },
      due_amount: { currency_code: 'USD', value: status === 'PARTIALLY_PAID' ? '4.00' : '10.00' },
      primary_recipients: [],
    });
  }
  let n = 0;
  const stub = stubFetch(async (url, request) => {
    const path = url.pathname;
    if (path.endsWith('/v1/oauth2/token')) return tokenResponse();
    if (request.method === 'POST' && path === '/v2/invoicing/invoices') {
      if (options.duplicateNumbers === true) {
        return jsonResponse(
          422,
          paypalError('DUPLICATE_INVOICE_NUMBER', 'Invoice number is a duplicate'),
        );
      }
      const body = JSON.parse(await request.text()) as {
        detail: Record<string, unknown>;
        primary_recipients: unknown[];
        items: { unit_amount: { value: string } }[];
      };
      const id = `INV2-SEED-${String(++n)}`;
      const value = body.items[0]!.unit_amount.value;
      invoices.set(id, {
        id,
        status: 'DRAFT',
        detail: {
          ...body.detail,
          metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` },
        },
        primary_recipients: body.primary_recipients,
        amount: { currency_code: 'USD', value },
        due_amount: { currency_code: 'USD', value },
      });
      return jsonResponse(201, invoices.get(id));
    }
    const send = /^\/v2\/invoicing\/invoices\/([^/]+)\/send$/.exec(path);
    if (send !== null) {
      invoices.get(send[1]!)!['status'] = 'SENT';
      return new Response(null, { status: 202 });
    }
    const pay = /^\/v2\/invoicing\/invoices\/([^/]+)\/payments$/.exec(path);
    if (pay !== null) {
      payments.push({ id: pay[1]!, body: JSON.parse(await request.text()) as unknown });
      invoices.get(pay[1]!)!['status'] = 'PAID';
      return jsonResponse(200, { payment_id: `PAY-${pay[1]!}` });
    }
    const cancel = /^\/v2\/invoicing\/invoices\/([^/]+)\/cancel$/.exec(path);
    if (cancel?.[1] === 'INV2-SPIKE-LOCKED') {
      return jsonResponse(422, paypalError('CANNOT_CANCEL', 'Invoice cannot be cancelled'));
    }
    if (cancel !== null) {
      invoices.get(cancel[1]!)!['status'] = 'CANCELLED';
      return new Response(null, { status: 204 });
    }
    if (request.method === 'GET' && path === '/v2/invoicing/invoices') {
      return jsonResponse(200, {
        items: [...invoices.values()].map((i) => ({ id: i['id'], status: i['status'] })),
        total_pages: 1,
      });
    }
    const one = /^\/v2\/invoicing\/invoices\/([^/]+)$/.exec(path);
    if (one !== null) return jsonResponse(200, invoices.get(one[1]!));
    if (path === '/v1/reporting/transactions')
      return jsonResponse(200, { transaction_details: [], total_pages: 1, page: 1 });
    if (path === '/v1/reporting/balances') {
      return jsonResponse(200, {
        balances: [
          {
            currency: 'USD',
            available_balance: { currency_code: 'USD', value: '5200.00' },
            total_balance: { currency_code: 'USD', value: '5200.00' },
          },
        ],
        as_of_time: '2026-11-09T13:29:59Z',
      });
    }
    throw new Error(`unexpected ${request.method} ${path}`);
  });
  return { stub, invoices, payments };
}

function seeder(fetch: typeof globalThis.fetch) {
  const { services } = testApp(db, { now, paypalFetch: fetch });
  return { seed: new DemoSeed(db, services.paypal!, services.ledger), services };
}

describe('demo seed (fake sandbox)', () => {
  it('creates the scenario in Terms and as real, sent PayPal invoices, then imports them', async () => {
    const sandbox = fakeSandbox();
    const { seed } = seeder(sandbox.stub.fetch);
    const report = await seed.run({ now });

    expect(report.invoices.map((i) => [i.number, i.created, i.sent])).toEqual(
      DEMO_INVOICES.map((s) => [s.number, true, true]),
    );
    expect(report.payrollDate).toBe('2026-11-13');
    expect(report.sync.invoices).toEqual({ imported: 5, updated: 0, unchanged: 0, total: 5 });
    expect(report.harborVault).toBe('not set');

    // Oak Street's invoice is six days overdue; every invoice is from Maya Studio.
    const oakCreate = sandbox.stub.calls.find(
      (c) => c.request.method === 'POST' && c.url.pathname === '/v2/invoicing/invoices',
    )!;
    const body = JSON.parse(oakCreate.body!) as {
      detail: { payment_term: { due_date: string } };
      invoicer: { business_name: string };
    };
    expect(body.detail.payment_term.due_date).toBe('2026-11-03');
    expect(body.invoicer.business_name).toBe('Maya Studio');
    expect(oakCreate.request.headers.get('paypal-request-id')).toMatch(/^[0-9a-f-]{36}$/);

    // The mirror: five open demo invoices, matched to the demo clients by email.
    const rows = await db.invoice.findMany({
      include: { client: true },
      orderBy: { number: 'asc' },
    });
    expect(
      rows.map((r) => [r.number, r.client.name, r.amountCents, r.isDemo, r.contactAllowed]),
    ).toEqual([
      ['1038', 'Oak Street Bakery', dollars(1800), true, true],
      ['1039', 'Pinecrest Dental', dollars(2000), true, false],
      ['1041', 'Juniper Labs', dollars(5000), true, true],
      ['1042', 'Birch Legal', dollars(1200), true, false],
      ['1043', 'Harbor & Co', dollars(7500), true, true],
    ]);
    expect(await db.business.count()).toBe(6);
    const policy = await db.supplierPolicy.findFirstOrThrow();
    expect(policy).toMatchObject({
      maxDiscountBps: 120,
      bufferBps: 500,
      costCeilingCents: dollars(60),
    });
    expect(await db.clientPolicy.count()).toBe(2);
    expect(
      await db.cashEvent.count({ where: { kind: 'PAYROLL', source: 'CONFIRMED_RECURRING' } }),
    ).toBe(1);
    expect((await db.payPalAccount.findFirstOrThrow()).balanceCents).toBe(dollars(5200));

    // Running again creates and sends nothing twice.
    const calls = sandbox.stub.calls.filter((c) => c.request.method === 'POST').length;
    const again = await seed.run({ now });
    expect(again.invoices.every((i) => !i.created)).toBe(true);
    expect(sandbox.stub.calls.filter((c) => c.request.method === 'POST')).toHaveLength(calls);
    expect(await db.cashEvent.count({ where: { kind: 'PAYROLL' } })).toBe(1);
  });

  it('resets a previous run and cancels stray invoices when asked', async () => {
    const sandbox = fakeSandbox({
      stray: ['INV2-SPIKE-1', 'INV2-SPIKE-PART:PARTIALLY_PAID', 'INV2-SPIKE-LOCKED'],
    });
    const { seed } = seeder(sandbox.stub.fetch);
    const first = await seed.run({ now });
    // The spike leftover is imported but not labelled demo.
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { paypalInvoiceId: 'INV2-SPIKE-1' } })).isDemo,
    ).toBe(false);

    const second = await seed.run({
      now,
      reset: true,
      cancelStray: true,
      suffix: 'B',
      harborPaymentToken: 'TOKEN-H',
    });
    expect(second.cancelled.sort()).toEqual(
      [...first.invoices.map((i) => i.paypalInvoiceId), 'INV2-SPIKE-1'].sort(),
    );
    // Money on a partly paid invoice is never cancelled; a refusal is reported, not fatal.
    expect(second.skipped).toEqual([
      { paypalInvoiceId: 'INV2-SPIKE-PART', reason: 'partly paid' },
      {
        paypalInvoiceId: 'INV2-SPIKE-LOCKED',
        reason: 'PayPal refused: Invoice cannot be cancelled',
      },
    ]);
    expect(second.invoices.map((i) => i.number)).toEqual([
      '1038-B',
      '1039-B',
      '1041-B',
      '1042-B',
      '1043-B',
    ]);
    expect(second.harborVault).toBe('registered');
    // Cancelled invoices stay cancelled in the mirror; the open demo rows are this run's, and the
    // one PayPal would not cancel stays open but is not labelled demo.
    const open = await db.invoice.findMany({ where: { paypalStatus: 'SENT', isDemo: true } });
    expect(
      (await db.invoice.findUniqueOrThrow({ where: { paypalInvoiceId: 'INV2-SPIKE-LOCKED' } }))
        .isDemo,
    ).toBe(false);
    expect(open.map((i) => i.number).sort()).toEqual([
      '1038-B',
      '1039-B',
      '1041-B',
      '1042-B',
      '1043-B',
    ]);
    expect((await seed.run({ now, suffix: 'B' })).harborVault).toBe('already saved');
  });

  it('explains a duplicate invoice number', async () => {
    const { seed } = seeder(fakeSandbox({ duplicateNumbers: true }).stub.fetch);
    await expect(seed.run({ now })).rejects.toThrow(
      'Invoice 1038: Invoice number is a duplicate (use --suffix for a new run)',
    );
  });

  it('closes a partly paid leftover by recording what is due, once, and never a demo invoice', async () => {
    const sandbox = fakeSandbox({ stray: ['INV2-SPIKE-PART:PARTIALLY_PAID'] });
    const { seed } = seeder(sandbox.stub.fetch);
    await seed.run({ now });
    const report = await seed.run({ now, cancelStray: true, settleStray: true });
    expect(report.settled).toEqual(['INV2-SPIKE-PART']);
    expect(report.skipped).toEqual([]);
    expect(sandbox.payments).toHaveLength(1);
    expect(sandbox.payments[0]).toMatchObject({
      id: 'INV2-SPIKE-PART',
      body: {
        method: 'OTHER',
        payment_date: '2026-11-09',
        amount: { currency_code: 'USD', value: '4.00' },
        note: expect.stringContaining('test leftover') as unknown,
      },
    });
    expect(sandbox.invoices.get('INV2-SPIKE-PART')?.['status']).toBe('PAID');

    // Running again records nothing twice (the invoice is no longer open, and the write is claimed).
    const again = await seed.run({ now, cancelStray: true, settleStray: true });
    expect(again.settled).toEqual([]);
    expect(sandbox.payments).toHaveLength(1);
  });

  it('leaves partly paid leftovers alone unless asked', async () => {
    const sandbox = fakeSandbox({ stray: ['INV2-SPIKE-PART:PARTIALLY_PAID'] });
    const { seed } = seeder(sandbox.stub.fetch);
    const report = await seed.run({ now, cancelStray: true });
    expect(report.settled).toEqual([]);
    expect(report.skipped).toEqual([{ paypalInvoiceId: 'INV2-SPIKE-PART', reason: 'partly paid' }]);
    expect(sandbox.payments).toHaveLength(0);
  });

  it('seeds the scale shot: 30 invoices across 12 clients, each new client with an agent', async () => {
    const sandbox = fakeSandbox();
    const { seed } = seeder(sandbox.stub.fetch);
    const report = await seed.run({ now, scale: true });
    expect(report.invoices).toHaveLength(30);
    expect(new Set(SCALE_INVOICES.map((i) => i.slug)).size).toBe(7);
    expect(SCALE_INVOICES.every((i) => i.amount >= 600 && i.dueIn >= 8)).toBe(true);

    const open = await db.invoice.findMany({ where: { isDemo: true }, include: { client: true } });
    expect(open).toHaveLength(30);
    expect(new Set(open.map((i) => i.clientId)).size).toBe(12);
    // Every scale invoice was matched to its client by email, and every scale client negotiates.
    const scale = await db.business.findMany({
      where: { slug: { in: SCALE_CLIENTS.map((c) => c.slug) } },
      include: { clientPolicy: true },
    });
    expect(scale).toHaveLength(7);
    expect(scale.every((b) => b.hasAgent && b.isDemo && b.clientPolicy !== null)).toBe(true);
    expect(open.filter((i) => i.number.startsWith('20')).every((i) => i.client.hasAgent)).toBe(
      true,
    );

    // Without the option nothing extra is created.
    const plain = fakeSandbox();
    await resetDb(db);
    const { seed: again } = seeder(plain.stub.fetch);
    expect((await again.run({ now })).invoices).toHaveLength(5);
  });
});
