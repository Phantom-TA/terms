import { readFileSync } from 'node:fs';
import { dollars } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { AppError } from '../../src/errors.js';
import { InvoiceService } from '../../src/paypal/invoice-service.js';
import { PayPalRestClient } from '../../src/paypal/rest-client.js';
import { Settlement } from '../../src/paypal/settlement.js';
import {
  WEBHOOK_EVENT_TYPES,
  type WebhookHeaders,
  WebhookService,
} from '../../src/paypal/webhook-service.js';
import { WriteLedger } from '../../src/paypal/write-ledger.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import {
  dropConnection,
  jsonResponse,
  paypalError,
  routePayPal,
  testPayPalConfig,
} from '../helpers/fake-fetch.js';
import { type ScenarioIds, seedDeal, seedScenario, TODAY } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
const ledger = new WriteLedger();

interface Delivery {
  webhookId: string;
  headers: WebhookHeaders;
  body: string;
}
const fixture = (name: string): Delivery =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/paypal/${name}.json`, import.meta.url), 'utf8'),
  ) as Delivery;
const CERT = readFileSync(
  new URL('../fixtures/paypal/sandbox-signing-cert.pem', import.meta.url),
  'utf8',
);

/** Real, PayPal-signed sandbox deliveries captured in spike S3. */
const capture = fixture('capture-completed');
const partial = fixture('invoice-paid-partial');

let ids: ScenarioIds;
let certFetches: string[];

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
  certFetches = [];
});

afterAll(async () => {
  await db.$disconnect();
});

const VERIFY = 'POST /v1/notifications/verify-webhook-signature';
const verdict = (status: 'SUCCESS' | 'FAILURE') => () =>
  jsonResponse(200, { verification_status: status });

function service(
  routes: Parameters<typeof routePayPal>[0],
  webhookId: string | null = capture.webhookId,
) {
  const stub = routePayPal(routes);
  const rest = new PayPalRestClient(testPayPalConfig, {
    fetch: stub.fetch,
    backoffMs: 0,
    maxRetries: 0,
  });
  const invoices = new InvoiceService(db, rest, ledger, audit, deals);
  const settlement = new Settlement(db, audit, deals, invoices);
  const svc = new WebhookService(db, rest, ledger, audit, settlement, {
    webhookId,
    fetchCert: (url) => {
      certFetches.push(url);
      return Promise.resolve(CERT);
    },
  });
  return { svc, stub, settlement };
}

/** A deal awaiting payment whose agreed payment is `payment`, optionally with a fixed id. */
async function awaitingDeal(o: {
  id?: string;
  amountEarly: string;
  remainderDue: string | null;
  invoice?: '1041' | '1043';
}) {
  // seedDeal's own SUGGESTED deal would be a second open deal on the invoice; drop it.
  const { plan, deal: seeded } = await seedDeal(db, ids);
  await db.deal.delete({ where: { id: seeded.id } });
  const invoiceId = ids.invoices[o.invoice ?? '1043'];
  const item = await db.planItem.create({
    data: {
      planId: plan.id,
      invoiceId,
      action: 'NEGOTIATE',
      rank: 'PRIMARY',
      reasonCode: 'PARTIAL_TO_FIT_GAP',
      reason: 't',
    },
  });
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const deal = await db.deal.create({
    data: {
      ...(o.id === undefined ? {} : { id: o.id }),
      planItemId: item.id,
      planId: plan.id,
      invoiceId,
      clientId: invoice.clientId,
      action: 'NEGOTIATE',
      paypalInvoiceId: invoice.paypalInvoiceId,
      state: 'AWAITING_PAYMENT',
      agreedTerms: {
        amountEarly: o.amountEarly,
        discountPct: '1.20',
        payBy: TODAY,
        remainderDue: o.remainderDue,
      },
    },
  });
  return deal.id;
}

const isAppError = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe('WebhookService.receive with real signed sandbox deliveries', () => {
  it('verifies locally when the verify API is down, then settles the agent’s deal PAID', async () => {
    // custom_id "spike-s3" and $1.00 are what spike S3 sent; $1.01 at 1.20% pays exactly $1.00.
    const dealId = await awaitingDeal({ id: 'spike-s3', amountEarly: '1.01', remainderDue: null });
    const { svc } = service({ [VERIFY]: dropConnection });
    const outcome = await svc.receive(Buffer.from(capture.body), capture.headers);
    expect(outcome).toMatchObject({
      status: 'processed',
      type: 'PAYMENT.CAPTURE.COMPLETED',
      detail: 'deal PAID',
    });
    expect(certFetches).toEqual([capture.headers['paypal-cert-url']]);

    const deal = await deals.get(db, dealId);
    expect(deal).toMatchObject({
      state: 'PAID',
      paypalCaptureId: '43D00653CU573371H',
      paypalOrderId: '3EE76589DR052092H',
    });
    const stored = await db.webhookEvent.findFirstOrThrow();
    expect(stored).toMatchObject({ verified: true, verificationStatus: 'LOCAL_SUCCESS' });
    expect(stored.processedAt).not.toBeNull();
    expect(await db.paymentRecord.findFirstOrThrow()).toMatchObject({
      captureId: '43D00653CU573371H',
      amountCents: dollars(1),
    });
    const trail = await audit.list(db, ids.harbor, { limit: 10, dealId });
    expect(trail.entries.map((e) => e.action)).toEqual(['WEBHOOK_VERIFIED', 'DEAL_TRANSITION']);
    expect(trail.entries[1]).toMatchObject({
      actor: 'PAYPAL',
      paypalCall: 'webhook PAYMENT.CAPTURE.COMPLETED',
    });

    // PayPal re-delivers the same event id: nothing happens twice.
    const again = await svc.receive(Buffer.from(capture.body), capture.headers);
    expect(again.status).toBe('duplicate');
    const dup = await audit.list(db, ids.maya, { limit: 5, action: 'WEBHOOK_DUPLICATE' });
    expect(dup.entries).toHaveLength(1);
    expect(
      (await audit.list(db, ids.maya, { limit: 5, action: 'DEAL_TRANSITION', dealId })).entries,
    ).toHaveLength(1);
  });

  it('rejects a tampered body and never acts on it', async () => {
    const dealId = await awaitingDeal({ id: 'spike-s3', amountEarly: '1.01', remainderDue: null });
    const tampered = capture.body.replace('"value":"1.00"', '"value":"9.00"');
    expect(tampered).not.toBe(capture.body);
    const { svc } = service({ [VERIFY]: dropConnection });
    const outcome = await svc.receive(Buffer.from(tampered), capture.headers);
    expect(outcome.status).toBe('rejected');
    expect((await deals.get(db, dealId)).state).toBe('AWAITING_PAYMENT');
    expect(await db.webhookEvent.findFirstOrThrow()).toMatchObject({
      verified: false,
      verificationStatus: 'LOCAL_FAILURE',
    });
    // The owner sees the rejection in the audit trail; the client does not.
    const rejected = await audit.list(db, ids.maya, { limit: 5, action: 'WEBHOOK_REJECTED' });
    expect(rejected.entries[0]).toMatchObject({ webhookVerified: false });
    const forClient = await audit.list(db, ids.harbor, { limit: 5, action: 'WEBHOOK_REJECTED' });
    expect(forClient.entries).toHaveLength(0);
  });

  it('trusts only a certificate from a paypal.com host', async () => {
    const { svc } = service({ [VERIFY]: dropConnection });
    const forged = { ...capture.headers, 'paypal-cert-url': 'https://evil.example.com/cert.pem' };
    expect((await svc.receive(Buffer.from(capture.body), forged)).status).toBe('rejected');
    expect(certFetches).toEqual([]);
    const missing = { ...capture.headers };
    delete missing['paypal-transmission-sig'];
    expect(await svc.verifyLocally(Buffer.from(capture.body), missing, capture.webhookId)).toBe(
      false,
    );
    expect(
      await svc.verifyLocally(Buffer.from(capture.body), capture.headers, 'WRONG-WEBHOOK'),
    ).toBe(false);
  });

  it('settles an invoice payment from the invoice status the event carries', async () => {
    // The fixture is Juniper's S1 invoice after a $100 partial payment.
    await db.invoice.update({
      where: { id: ids.invoices['1041'] },
      data: { paypalInvoiceId: 'INV2-V8DF-9KKR-9FR3-REUZ' },
    });
    const dealId = await awaitingDeal({
      amountEarly: '1000.00',
      remainderDue: '2026-11-27',
      invoice: '1041',
    });
    const { svc } = service({ [VERIFY]: verdict('SUCCESS') });
    const outcome = await svc.receive(Buffer.from(partial.body), partial.headers);
    expect(outcome).toMatchObject({
      status: 'processed',
      type: 'INVOICING.INVOICE.PAID',
      detail: 'deal PARTIALLY_PAID',
    });
    expect((await deals.get(db, dealId)).state).toBe('PARTIALLY_PAID');
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: ids.invoices['1041'] } });
    expect(invoice).toMatchObject({
      paypalStatus: 'PARTIALLY_PAID',
      amountPaidCents: dollars(100),
      amountDueCents: dollars(4860),
    });
    expect((await db.webhookEvent.findFirstOrThrow()).verificationStatus).toBe('SUCCESS');
  });

  it('rejects what PayPal’s verify API says is not genuine', async () => {
    const { svc } = service({ [VERIFY]: verdict('FAILURE') });
    expect((await svc.receive(Buffer.from(capture.body), capture.headers)).status).toBe('rejected');
    const refused = service({
      [VERIFY]: () => jsonResponse(400, paypalError('VALIDATION_ERROR', 'Invalid transmission')),
    });
    await resetDb(db);
    ids = await seedScenario(db);
    expect((await refused.svc.receive(Buffer.from(capture.body), capture.headers)).status).toBe(
      'rejected',
    );
  });
});

describe('WebhookService.receive: bodies, configuration and failures', () => {
  const event = (id: string, type: string, resource: unknown) =>
    Buffer.from(JSON.stringify({ id, event_type: type, resource }));

  it('refuses what is not a PayPal event, and needs a webhook id', async () => {
    const { svc } = service({ [VERIFY]: verdict('SUCCESS') });
    await expect(svc.receive(Buffer.from('not json'), {})).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    await expect(svc.receive(Buffer.from('{"hello":1}'), {})).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    const unconfigured = service({}, null);
    await expect(
      unconfigured.svc.receive(Buffer.from(capture.body), capture.headers),
    ).rejects.toSatisfy(isAppError('NOT_CONFIGURED'));
  });

  it('records types it does not act on, and settles a full invoice payment PAID', async () => {
    const { svc } = service({ [VERIFY]: verdict('SUCCESS') });
    const vault = await svc.receive(event('WH-1', 'VAULT.PAYMENT-TOKEN.CREATED', { id: 'T' }), {});
    expect(vault).toMatchObject({
      status: 'processed',
      detail: 'recorded; no action for this type',
    });

    const dealId = await awaitingDeal({ amountEarly: '7500.00', remainderDue: null });
    const paid = {
      invoice: {
        id: 'INV2-TEST-1043',
        status: 'PAID',
        detail: { invoice_number: '1043' },
        amount: { currency_code: 'USD', value: '7410.00' },
        due_amount: { currency_code: 'USD', value: '0.00' },
        payments: { paid_amount: { currency_code: 'USD', value: '7410.00' } },
      },
    };
    const r = await svc.receive(event('WH-2', 'INVOICING.INVOICE.PAID', paid), {});
    expect(r).toMatchObject({ detail: 'deal PAID' });
    expect((await deals.get(db, dealId)).state).toBe('PAID');

    const unknownInvoice = { invoice: { ...paid.invoice, id: 'INV2-NOT-OURS' } };
    expect(
      await svc.receive(event('WH-3', 'INVOICING.INVOICE.PAID', unknownInvoice), {}),
    ).toMatchObject({
      detail: 'invoice INV2-NOT-OURS is not mirrored',
    });
    const updated = { invoice: { ...paid.invoice, status: 'SENT' } };
    expect(
      await svc.receive(event('WH-4', 'INVOICING.INVOICE.UPDATED', updated), {}),
    ).toMatchObject({
      detail: 'invoice is SENT',
    });
    // Deal already PAID: nothing left open on that invoice.
    expect(await svc.receive(event('WH-5', 'INVOICING.INVOICE.PAID', paid), {})).toMatchObject({
      detail: 'no open deal on this invoice',
    });
  });

  it('settles a split deal PARTIALLY_PAID from its capture, and refuses a wrong amount', async () => {
    const { svc } = service({ [VERIFY]: verdict('SUCCESS') });
    const dealId = await awaitingDeal({ amountEarly: '1750.00', remainderDue: '2026-12-03' });
    const cap = (id: string, value: string, status = 'COMPLETED', custom: string | null = dealId) =>
      event(id, 'PAYMENT.CAPTURE.COMPLETED', {
        id: `CAP-${id}`,
        status,
        amount: { currency_code: 'USD', value },
        ...(custom === null ? {} : { custom_id: custom }),
      });
    expect(await svc.receive(cap('A', '1700.00'), {})).toMatchObject({
      detail: 'amount differs from the agreed payment',
    });
    expect(await svc.receive(cap('B', '1729.00', 'PENDING'), {})).toMatchObject({
      detail: 'capture PENDING',
    });
    expect(await svc.receive(cap('C', '1729.00', 'COMPLETED', null), {})).toMatchObject({
      detail: 'capture has no Terms deal id',
    });
    expect(await svc.receive(cap('D', '1729.00', 'COMPLETED', 'no-such-deal'), {})).toMatchObject({
      detail: 'no deal no-such-deal',
    });
    expect(await svc.receive(cap('E', '1729.00'), {})).toMatchObject({
      detail: 'deal PARTIALLY_PAID',
    });
    expect(await svc.receive(cap('F', '1729.00'), {})).toMatchObject({
      detail: 'deal already PARTIALLY_PAID',
    });
    const mismatch = await audit.list(db, ids.maya, { limit: 10, action: 'PAYPAL_ERROR' });
    expect(mismatch.entries[0]!.summary).toContain('not the agreed $1,729.00');
  });

  it('keeps a verified event whose processing failed, and processes it on re-delivery', async () => {
    const { svc } = service({ [VERIFY]: verdict('SUCCESS') });
    const broken = event('WH-9', 'PAYMENT.CAPTURE.COMPLETED', { id: 'CAP', status: 'COMPLETED' });
    await expect(svc.receive(broken, {})).rejects.toThrow();
    const stored = await db.webhookEvent.findFirstOrThrow();
    expect(stored).toMatchObject({ verified: true, processedAt: null });
    expect(stored.processingError).not.toBeNull();
    // Re-delivery is processed again (not treated as a duplicate) and fails the same way.
    await expect(svc.receive(broken, {})).rejects.toThrow();
    expect(await db.webhookEvent.count()).toBe(1);
  });
});

describe('WebhookService.ensureRegistered', () => {
  const URL_ = 'https://terms.example.com/api/webhooks/paypal';

  it('reuses an existing registration', async () => {
    const { svc, stub } = service({
      'GET /v1/notifications/webhooks': [
        jsonResponse(200, { webhooks: [{ id: 'WH-OLD', url: URL_ }] }),
      ],
    });
    expect(await svc.ensureRegistered(URL_)).toBe('WH-OLD');
    expect(stub.apiCalls()).toHaveLength(1);
  });

  it('registers once for every event type Terms handles', async () => {
    const { svc, stub } = service({
      'GET /v1/notifications/webhooks': () => jsonResponse(200, { webhooks: [] }),
      'POST /v1/notifications/webhooks': [jsonResponse(201, { id: 'WH-NEW', url: URL_ })],
    });
    expect(await svc.ensureRegistered(URL_)).toBe('WH-NEW');
    const create = stub.last();
    expect(JSON.parse(create.body!)).toEqual({
      url: URL_,
      event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })),
    });
    expect(create.request.headers.get('paypal-request-id')).toBe(
      (await ledger.get(db, `webhook:${URL_}`))!.requestId,
    );
    // A second call reuses the claim's result without creating another.
    expect(await svc.ensureRegistered(URL_)).toBe('WH-NEW');
    expect(stub.apiCalls().filter((c) => c.request.method === 'POST')).toHaveLength(1);
  });

  it('reports refusals and unknown outcomes', async () => {
    const refused = service({
      'GET /v1/notifications/webhooks': () => jsonResponse(200, { webhooks: [] }),
      'POST /v1/notifications/webhooks': [
        jsonResponse(400, paypalError('INVALID_REQUEST', 'URL must be https')),
      ],
    });
    await expect(refused.svc.ensureRegistered('http://x')).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    const lost = service({
      'GET /v1/notifications/webhooks': () => jsonResponse(200, { webhooks: [] }),
      'POST /v1/notifications/webhooks': dropConnection,
    });
    await expect(lost.svc.ensureRegistered(URL_)).rejects.toThrow('may have registered');
    const down = service({
      'GET /v1/notifications/webhooks': [jsonResponse(500, paypalError('X', 'y'))],
    });
    await expect(down.svc.ensureRegistered(URL_)).rejects.toSatisfy(isAppError('PAYPAL_ERROR'));
  });
});
