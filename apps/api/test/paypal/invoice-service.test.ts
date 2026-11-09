import { dollars } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { AppError } from '../../src/errors.js';
import {
  hasTerms,
  InvoiceService,
  invoiceTermsFor,
  updatedInvoiceBody,
} from '../../src/paypal/invoice-service.js';
import { WireInvoice } from '../../src/paypal/invoice-wire.js';
import { PayPalRestClient } from '../../src/paypal/rest-client.js';
import { WriteLedger } from '../../src/paypal/write-ledger.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import {
  jsonResponse,
  paypalError,
  stubFetch,
  testPayPalConfig,
  tokenResponse,
  type Responder,
} from '../helpers/fake-fetch.js';
import { type ScenarioIds, seedDeal, seedScenario, TODAY } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
const ledger = new WriteLedger();

let ids: ScenarioIds;

/** A PayPal invoice in wire shape. */
function wire(o: {
  id?: string;
  status?: string;
  total: string;
  discount?: string;
  minimum?: string;
  paid?: string;
  transactions?: Record<string, unknown>[];
}) {
  return {
    id: o.id ?? 'INV2-TEST-1043',
    status: o.status ?? 'SENT',
    detail: {
      invoice_number: '1043',
      currency_code: 'USD',
      metadata: {
        recipient_view_url: 'https://www.sandbox.paypal.com/invoice/p/#TEST1043',
        last_update_time: '2026-11-09T19:00:00Z',
      },
    },
    amount: {
      currency_code: 'USD',
      value: o.total,
      breakdown: {
        item_total: { currency_code: 'USD', value: '7500.00' },
        ...(o.discount === undefined
          ? {}
          : {
              discount: {
                invoice_discount: { amount: { currency_code: 'USD', value: `-${o.discount}` } },
              },
            }),
      },
    },
    due_amount: {
      currency_code: 'USD',
      value: (Number(o.total) - Number(o.paid ?? '0')).toFixed(2),
    },
    ...(o.paid === undefined
      ? {}
      : {
          payments: {
            paid_amount: { currency_code: 'USD', value: o.paid },
            transactions: o.transactions ?? [],
          },
        }),
    configuration: {
      partial_payment:
        o.minimum === undefined
          ? { allow_partial_payment: false }
          : {
              allow_partial_payment: true,
              minimum_amount_due: { currency_code: 'USD', value: o.minimum },
            },
    },
  };
}

const ORIGINAL = wire({ total: '7500.00' });
const UPDATED = wire({ total: '7479.00', discount: '21.00', minimum: '1729.00' });

/** Routes PayPal requests by method and path; unmatched requests fail the test loudly. */
function paypal(routes: Record<string, Responder | Response[]>) {
  const queues = new Map<string, Response[]>();
  return stubFetch((url, request) => {
    if (url.pathname.endsWith('/v1/oauth2/token')) return tokenResponse();
    const key = `${request.method} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`unexpected PayPal call ${key}`);
    if (typeof route === 'function') return route(url, request);
    const queue = queues.get(key) ?? [...route];
    queues.set(key, queue);
    const next = queue.shift();
    if (next === undefined) throw new Error(`no more responses for ${key}`);
    return next;
  });
}

function service(fetch: typeof globalThis.fetch) {
  const rest = new PayPalRestClient(testPayPalConfig, { fetch, backoffMs: 0, maxRetries: 0 });
  return new InvoiceService(db, rest, ledger, audit, deals);
}

const INVOICE = '/v2/invoicing/invoices/INV2-TEST-1043';

async function agreedDeal(amountEarly = '1750.00') {
  const { deal } = await seedDeal(db, ids);
  await deals.transition({ dealId: deal.id, to: 'APPROVED', actor: 'OWNER', reason: 'plan' });
  await deals.transition({ dealId: deal.id, to: 'SENT', actor: 'SUPPLIER_AGENT', reason: 'offer' });
  await deals.transition({
    dealId: deal.id,
    to: 'AGREED',
    actor: 'CLIENT_AGENT',
    reason: 'accepted 1.20%',
    patch: {
      agreedTerms: { amountEarly, discountPct: '1.20', payBy: TODAY, remainderDue: '2026-12-03' },
    },
  });
  return deal.id;
}

async function reminderDeal() {
  const { plan } = await seedDeal(db, ids);
  const item = await db.planItem.create({
    data: {
      planId: plan.id,
      invoiceId: ids.invoices['1038'],
      action: 'REMINDER',
      rank: 'PRIMARY',
      reasonCode: 'REMINDER_OVERDUE',
      reason: 'test',
    },
  });
  const deal = await db.deal.create({
    data: {
      planItemId: item.id,
      planId: plan.id,
      invoiceId: ids.invoices['1038'],
      clientId: ids.oak,
      action: 'REMINDER',
      paypalInvoiceId: 'INV2-TEST-1038',
    },
  });
  await deals.transition({ dealId: deal.id, to: 'APPROVED', actor: 'OWNER', reason: 'plan' });
  return deal.id;
}

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const isAppError = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe('invoice terms (pure)', () => {
  it('turns an agreement into a discount and, for a split deal, a minimum', () => {
    const split = { amountEarly: '1750.00', discountPct: '1.20', payBy: TODAY, remainderDue: null };
    expect(invoiceTermsFor(split, dollars(7500))).toEqual({
      discountCents: dollars(21),
      minimumCents: dollars(1729),
    });
    const whole = { ...split, amountEarly: '5000.00', discountPct: '0.80' };
    expect(invoiceTermsFor(whole, dollars(5000))).toEqual({
      discountCents: dollars(40),
      minimumCents: null,
    });
  });

  it('recomputes the total from the current discount and keeps unknown fields', () => {
    const current = WireInvoice.parse({ ...wire({ total: '7486.00', discount: '14.00' }), x: 1 });
    const body = updatedInvoiceBody(current, {
      discountCents: dollars(21),
      minimumCents: dollars(1729),
    });
    expect(body.amount?.value).toBe('7479.00');
    expect(body.amount?.breakdown?.discount?.invoice_discount?.amount?.value).toBe('21.00');
    expect(body.configuration?.partial_payment).toEqual({
      allow_partial_payment: true,
      minimum_amount_due: { currency_code: 'USD', value: '1729.00' },
    });
    expect((body as Record<string, unknown>)['x']).toBe(1);
    expect(
      hasTerms(WireInvoice.parse(UPDATED), {
        discountCents: dollars(21),
        minimumCents: dollars(1729),
      }),
    ).toBe(true);
    expect(
      hasTerms(WireInvoice.parse(ORIGINAL), { discountCents: dollars(21), minimumCents: null }),
    ).toBe(false);
    expect(() =>
      updatedInvoiceBody(WireInvoice.parse({ id: 'X', status: 'SENT', detail: {} }), {
        discountCents: 1n,
        minimumCents: null,
      }),
    ).toThrow('has no amount');
  });
});

describe('InvoiceService.applyTerms (Postgres, fake PayPal)', () => {
  it('applies the agreed terms with one claimed PUT and moves the deal to AWAITING_PAYMENT', async () => {
    const dealId = await agreedDeal();
    const stub = paypal({
      [`GET ${INVOICE}`]: [jsonResponse(200, ORIGINAL)],
      [`PUT ${INVOICE}`]: [jsonResponse(200, UPDATED, { 'paypal-debug-id': 'dbg-put' })],
    });
    const svc = service(stub.fetch);
    const { deal, outcome } = await svc.applyTerms(dealId);
    expect(outcome).toBe('applied');
    expect(deal.state).toBe('AWAITING_PAYMENT');
    expect(deal.payerUrl).toBe('https://www.sandbox.paypal.com/invoice/p/#TEST1043');

    const put = stub.apiCalls().find((c) => c.request.method === 'PUT')!;
    const write = await ledger.get(db, `invoice-update:${dealId}`);
    expect(write).toMatchObject({ status: 'SUCCEEDED', resultRef: 'INV2-TEST-1043' });
    expect(put.request.headers.get('paypal-request-id')).toBe(write!.requestId);
    expect(put.url.searchParams.get('send_to_recipient')).toBe('true');
    const body = JSON.parse(put.body!) as ReturnType<typeof wire>;
    expect(body.amount.value).toBe('7479.00');

    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: ids.invoices['1043'] } });
    expect(invoice).toMatchObject({ amountCents: dollars(7479), amountDueCents: dollars(7479) });
    const trail = await audit.list(db, ids.harbor, { limit: 10, dealId });
    expect(trail.entries.map((e) => [e.action, e.paypalCall])).toEqual(
      expect.arrayContaining([
        ['INVOICE_UPDATED', 'PUT /v2/invoicing/invoices/{id}'],
        ['DEAL_TRANSITION', 'PUT /v2/invoicing/invoices/{id}'],
      ]),
    );

    // Calling again makes no PayPal call.
    const again = await svc.applyTerms(dealId);
    expect(again.deal.state).toBe('AWAITING_PAYMENT');
    expect(stub.apiCalls()).toHaveLength(2);
  });

  it('settles a dropped PUT by re-reading the invoice', async () => {
    const dealId = await agreedDeal();
    const stub = paypal({
      [`GET ${INVOICE}`]: [jsonResponse(200, ORIGINAL), jsonResponse(200, UPDATED)],
      [`PUT ${INVOICE}`]: () => {
        throw new Error('ECONNRESET');
      },
    });
    const { deal, outcome } = await service(stub.fetch).applyTerms(dealId);
    expect(outcome).toBe('applied');
    expect(deal.state).toBe('AWAITING_PAYMENT');
    expect(stub.apiCalls().map((c) => c.request.method)).toEqual(['GET', 'PUT', 'GET']);
  });

  it('keeps an unconfirmed write UNKNOWN, never failed, and settles it on a later call', async () => {
    const dealId = await agreedDeal();
    const first = paypal({
      [`GET ${INVOICE}`]: [jsonResponse(200, ORIGINAL), jsonResponse(200, ORIGINAL)],
      [`PUT ${INVOICE}`]: [jsonResponse(503, paypalError('INTERNAL_SERVER_ERROR', 'down'))],
    });
    const r1 = await service(first.fetch).applyTerms(dealId);
    expect(r1).toMatchObject({ outcome: 'unknown', deal: { state: 'AGREED' } });
    expect((await ledger.get(db, `invoice-update:${dealId}`))!.status).toBe('UNKNOWN');

    const later = paypal({ [`GET ${INVOICE}`]: [jsonResponse(200, UPDATED)] });
    const r2 = await service(later.fetch).applyTerms(dealId);
    expect(r2).toMatchObject({ outcome: 'applied', deal: { state: 'AWAITING_PAYMENT' } });
    // The settlement only read; it never sent the update again.
    expect(later.apiCalls().map((c) => c.request.method)).toEqual(['GET']);
  });

  it('fails the deal and releases the claim when PayPal refuses the update', async () => {
    const dealId = await agreedDeal();
    const stub = paypal({
      [`GET ${INVOICE}`]: [jsonResponse(200, ORIGINAL)],
      [`PUT ${INVOICE}`]: [
        jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Invoice is already paid')),
      ],
    });
    await expect(service(stub.fetch).applyTerms(dealId)).rejects.toSatisfy(
      (e) =>
        e instanceof AppError &&
        e.code === 'VALIDATION_FAILED' &&
        e.message === 'Invoice is already paid',
    );
    expect((await deals.get(db, dealId)).state).toBe('FAILED');
    expect(await ledger.get(db, `invoice-update:${dealId}`)).toBeNull();
    const errors = await audit.list(db, ids.maya, { limit: 5, action: 'PAYPAL_ERROR' });
    expect(errors.entries[0]).toMatchObject({
      dealId,
      paypalCall: 'PUT /v2/invoicing/invoices/{id}',
    });
  });

  it('sends nothing when no token can be obtained, and leaves the deal as it was', async () => {
    const dealId = await agreedDeal();
    const stub = stubFetch(() => jsonResponse(401, { error: 'invalid_client' }));
    await expect(service(stub.fetch).applyTerms(dealId)).rejects.toSatisfy(
      isAppError('PAYPAL_ERROR'),
    );
    expect(stub.apiCalls()).toHaveLength(0);
    expect((await deals.get(db, dealId)).state).toBe('AGREED');
    expect(await ledger.get(db, `invoice-update:${dealId}`)).toBeNull();
  });

  it('refuses deals that are not agreed or not tied to their invoice', async () => {
    const { deal } = await seedDeal(db, ids);
    const none = stubFetch(() => {
      throw new Error('no call expected');
    });
    await expect(service(none.fetch).applyTerms(deal.id)).rejects.toSatisfy(isAppError('CONFLICT'));
    await expect(service(none.fetch).applyTerms('missing')).rejects.toSatisfy(
      isAppError('NOT_FOUND'),
    );
    await db.deal.update({ where: { id: deal.id }, data: { paypalInvoiceId: 'INV2-OTHER' } });
    await expect(service(none.fetch).applyTerms(deal.id)).rejects.toSatisfy(isAppError('CONFLICT'));
    expect(none.calls).toHaveLength(0);
  });
});

describe('InvoiceService.remind', () => {
  const REMIND = '/v2/invoicing/invoices/INV2-TEST-1038/remind';

  it('sends one reminder and marks the deal SENT', async () => {
    const dealId = await reminderDeal();
    const stub = paypal({ [`POST ${REMIND}`]: [new Response(null, { status: 204 })] });
    const svc = service(stub.fetch);
    const r = await svc.remind(dealId, 'Friendly nudge');
    expect(r).toMatchObject({ outcome: 'applied', deal: { state: 'SENT' } });
    expect(JSON.parse(stub.last().body!)).toEqual({
      subject: 'Reminder: invoice 1038',
      note: 'Friendly nudge',
      send_to_invoicer: false,
    });
    expect((await svc.remind(dealId)).deal.state).toBe('SENT');
    expect(stub.apiCalls()).toHaveLength(1);
  });

  it('blocks a do-not-contact client before any PayPal call', async () => {
    const dealId = await reminderDeal();
    await db.supplierPolicy.update({
      where: { businessId: ids.maya },
      data: { doNotContact: [ids.oak] },
    });
    const none = stubFetch(() => {
      throw new Error('no call expected');
    });
    await expect(service(none.fetch).remind(dealId)).rejects.toSatisfy(
      isAppError('POLICY_BLOCKED'),
    );
    expect(none.calls).toHaveLength(0);
  });

  it('never re-sends a reminder whose outcome is unknown', async () => {
    const dealId = await reminderDeal();
    const dropped = paypal({
      [`POST ${REMIND}`]: () => {
        throw new Error('ECONNRESET');
      },
    });
    const r1 = await service(dropped.fetch).remind(dealId);
    expect(r1).toMatchObject({ outcome: 'unknown', deal: { state: 'APPROVED' } });
    const r2 = await service(dropped.fetch).remind(dealId);
    expect(r2.outcome).toBe('unknown');
    expect(dropped.apiCalls()).toHaveLength(1);
  });

  it('fails the deal when PayPal refuses the reminder', async () => {
    const dealId = await reminderDeal();
    const stub = paypal({
      [`POST ${REMIND}`]: [
        jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Invoice is cancelled')),
      ],
    });
    await expect(service(stub.fetch).remind(dealId)).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    expect((await deals.get(db, dealId)).state).toBe('FAILED');
  });

  it('only sends reminders for approved reminder deals', async () => {
    const dealId = await agreedDeal();
    const none = stubFetch(() => {
      throw new Error('no call expected');
    });
    await expect(service(none.fetch).remind(dealId)).rejects.toSatisfy(isAppError('CONFLICT'));
    const remindId = await reminderDeal();
    await deals.transition({
      dealId: remindId,
      to: 'WITHDRAWN',
      actor: 'SYSTEM',
      reason: 'goal met',
    });
    await expect(service(none.fetch).remind(remindId)).rejects.toSatisfy(isAppError('CONFLICT'));
  });
});

describe('InvoiceService.recordPayment', () => {
  const PAYMENTS = `${INVOICE}/payments`;
  const capture = { id: 'CAPTURE1', amountCents: dollars(1729), date: TODAY };

  async function withPaymentRecord() {
    const dealId = await agreedDeal();
    await db.paymentRecord.create({
      data: { dealId, captureId: 'CAPTURE1', amountCents: dollars(1729), status: 'CAPTURED' },
    });
    return dealId;
  }

  it('records the capture as a PayPal payment', async () => {
    const dealId = await withPaymentRecord();
    const stub = paypal({ [`POST ${PAYMENTS}`]: [jsonResponse(200, { payment_id: 'EXTR-1' })] });
    const r = await service(stub.fetch).recordPayment(dealId, capture);
    expect(r).toEqual({ invoicePaymentId: 'EXTR-1', outcome: 'applied' });
    expect(JSON.parse(stub.last().body!)).toMatchObject({
      method: 'PAYPAL',
      payment_id: 'CAPTURE1',
      payment_date: TODAY,
      amount: { currency_code: 'USD', value: '1729.00' },
    });
    expect(await db.paymentRecord.findFirstOrThrow({ where: { dealId } })).toMatchObject({
      status: 'RECORDED',
      invoicePaymentId: 'EXTR-1',
    });
    expect((await deals.get(db, dealId)).invoicePaymentId).toBe('EXTR-1');
  });

  it('falls back to an external payment carrying the capture id when PayPal cannot find it', async () => {
    const dealId = await withPaymentRecord();
    const stub = paypal({
      [`POST ${PAYMENTS}`]: [
        jsonResponse(
          404,
          paypalError('RESOURCE_NOT_FOUND', 'The specified resource does not exist.'),
        ),
        jsonResponse(200, { payment_id: 'EXTR-2' }),
      ],
    });
    const r = await service(stub.fetch).recordPayment(dealId, capture);
    expect(r.invoicePaymentId).toBe('EXTR-2');
    const [first, second] = stub.apiCalls();
    const fallback = JSON.parse(second!.body!) as { method: string; note: string };
    expect(fallback.method).toBe('OTHER');
    expect(fallback.note).toContain('CAPTURE1');
    expect(second!.request.headers.get('paypal-request-id')).toBe(
      `${first!.request.headers.get('paypal-request-id')!}-other`,
    );
    const recorded = await audit.list(db, ids.maya, { limit: 5, action: 'PAYMENT_RECORDED' });
    expect(recorded.entries[0]!.summary).toContain('external payment carrying the capture id');
  });

  it('settles a dropped record call by finding the capture on the invoice', async () => {
    const dealId = await withPaymentRecord();
    const paid = wire({
      status: 'PARTIALLY_PAID',
      total: '7479.00',
      paid: '1729.00',
      transactions: [
        { payment_id: 'EXTR-3', method: 'OTHER', note: 'PayPal capture CAPTURE1, paid' },
      ],
    });
    const stub = paypal({
      [`POST ${PAYMENTS}`]: () => {
        throw new Error('ECONNRESET');
      },
      [`GET ${INVOICE}`]: [jsonResponse(200, paid)],
    });
    const r = await service(stub.fetch).recordPayment(dealId, capture);
    expect(r).toEqual({ invoicePaymentId: 'EXTR-3', outcome: 'applied' });
    // A second call finds the settled claim and sends nothing.
    const again = await service(stub.fetch).recordPayment(dealId, capture);
    expect(again.outcome).toBe('applied');
    expect(stub.apiCalls()).toHaveLength(2);
  });

  it('stays unknown when the capture is not on the invoice yet', async () => {
    const dealId = await withPaymentRecord();
    const stub = paypal({
      [`POST ${PAYMENTS}`]: [jsonResponse(500, paypalError('INTERNAL_SERVER_ERROR', 'x'))],
      [`GET ${INVOICE}`]: [jsonResponse(200, ORIGINAL)],
    });
    expect((await service(stub.fetch).recordPayment(dealId, capture)).outcome).toBe('unknown');
    expect((await ledger.get(db, 'invoice-payment:CAPTURE1'))!.status).toBe('UNKNOWN');
  });

  it('releases the claim when PayPal refuses the record for another reason', async () => {
    const dealId = await withPaymentRecord();
    const stub = paypal({
      [`POST ${PAYMENTS}`]: [
        jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Amount too large')),
      ],
    });
    await expect(service(stub.fetch).recordPayment(dealId, capture)).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    expect(await ledger.get(db, 'invoice-payment:CAPTURE1')).toBeNull();
  });
});

describe('InvoiceService.read', () => {
  it('maps a missing invoice to NOT_FOUND', async () => {
    const stub = paypal({
      [`GET ${INVOICE}`]: [jsonResponse(404, paypalError('RESOURCE_NOT_FOUND', 'Not found'))],
    });
    await expect(service(stub.fetch).read('INV2-TEST-1043')).rejects.toSatisfy(
      isAppError('NOT_FOUND'),
    );
  });
});
