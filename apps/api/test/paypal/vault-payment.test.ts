import { dollars, webPaths } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { AppError } from '../../src/errors.js';
import { InvoiceService } from '../../src/paypal/invoice-service.js';
import { PaymentService } from '../../src/paypal/payment-service.js';
import { PayPalRestClient } from '../../src/paypal/rest-client.js';
import { buildPayPalSdkClient } from '../../src/paypal/sdk-client.js';
import { VaultService } from '../../src/paypal/vault-service.js';
import { WriteLedger } from '../../src/paypal/write-ledger.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import {
  dropConnection,
  jsonResponse,
  paypalError,
  routePayPal,
  stubFetch,
  testPayPalConfig,
} from '../helpers/fake-fetch.js';
import { type ScenarioIds, seedDeal, seedScenario, TODAY } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
const ledger = new WriteLedger();
const APP = 'https://terms.test';

let ids: ScenarioIds;

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const isAppError = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

function services(fetch: typeof globalThis.fetch) {
  const sdk = buildPayPalSdkClient(testPayPalConfig, { fetch, maxRetries: 0 });
  const rest = new PayPalRestClient(testPayPalConfig, { fetch, backoffMs: 0, maxRetries: 0 });
  const invoices = new InvoiceService(db, rest, ledger, audit, deals);
  return {
    vault: new VaultService(db, sdk, ledger, audit, APP),
    payments: new PaymentService(
      db,
      sdk,
      ledger,
      audit,
      deals,
      invoices,
      () => new Date('2026-11-09T15:00:00Z'),
    ),
  };
}

const noPayPal = () =>
  stubFetch(() => {
    throw new Error('no PayPal call expected');
  });

// ------------------------------------------------------------------------------- wire bodies

const setupToken = (status: string) => ({
  id: 'SETUP-1',
  status,
  payment_source: { paypal: {} },
  links: [
    {
      href: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=SETUP-1',
      rel: 'approve',
      method: 'GET',
    },
    {
      href: 'https://api-m.sandbox.paypal.com/v3/vault/setup-tokens/SETUP-1',
      rel: 'self',
      method: 'GET',
    },
  ],
});

const paymentToken = {
  id: 'TOKEN-1',
  customer: { id: 'CUST-1' },
  payment_source: { paypal: { email_address: 'harbor@terms-demo.example.com' } },
  links: [
    { href: 'https://api-m.sandbox.paypal.com/v3/vault/payment-tokens/TOKEN-1', rel: 'self' },
  ],
};

function order(status: string, captureStatus = 'COMPLETED', id = 'ORDER-1') {
  return {
    id,
    status,
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: 'default',
        payments:
          status === 'COMPLETED'
            ? {
                captures: [
                  {
                    id: 'CAPTURE-1',
                    status: captureStatus,
                    amount: { currency_code: 'USD', value: '1729.00' },
                  },
                ],
              }
            : {},
      },
    ],
    links: [{ href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${id}`, rel: 'self' }],
  };
}

// ------------------------------------------------------------------------------- vault

describe('VaultService (Postgres, fake PayPal through the SDK)', () => {
  it('starts one setup, hands back the approval link, then saves the token once approved', async () => {
    const stub = routePayPal({
      'POST /v3/vault/setup-tokens': [jsonResponse(201, setupToken('PAYER_ACTION_REQUIRED'))],
      'GET /v3/vault/setup-tokens/SETUP-1': [
        jsonResponse(200, setupToken('PAYER_ACTION_REQUIRED')),
        jsonResponse(200, setupToken('PAYER_ACTION_REQUIRED')),
        jsonResponse(200, setupToken('APPROVED')),
      ],
      'POST /v3/vault/payment-tokens': [jsonResponse(201, paymentToken)],
    });
    const { vault } = services(stub.fetch);

    const started = await vault.startSetup(ids.harbor);
    expect(started.status).toBe('PENDING');
    expect(started.approveUrl).toContain('SETUP-1');
    const create = stub.apiCalls()[0]!;
    const write = await ledger.get(db, `vault-setup:${started.vaultTokenId}`);
    expect(create.request.headers.get('paypal-request-id')).toBe(write!.requestId);
    // Our fields, plus three the SDK fills from its model defaults (paypal-plan.md); nothing else.
    expect(JSON.parse(create.body!)).toEqual({
      payment_source: {
        paypal: {
          usage_type: 'MERCHANT',
          permit_multiple_payment_tokens: false,
          experience_context: {
            return_url: `${APP}${webPaths.vaultReturn()}`,
            cancel_url: `${APP}${webPaths.vaultCancel()}`,
            shipping_preference: 'GET_FROM_FILE',
            user_action: 'CONTINUE',
          },
        },
      },
    });

    // A second click reuses the pending setup instead of creating another.
    const again = await vault.startSetup(ids.harbor);
    expect(again.vaultTokenId).toBe(started.vaultTokenId);
    expect(again.approveUrl).toBe(started.approveUrl);

    // Not approved yet: nothing is created.
    expect((await vault.completeSetup(ids.harbor)).status).toBe('PENDING');
    const saved = await vault.completeSetup(ids.harbor);
    expect(saved).toMatchObject({
      status: 'ACTIVE',
      paymentTokenId: 'TOKEN-1',
      payerEmail: 'harbor@terms-demo.example.com',
      approveUrl: null,
    });
    expect(JSON.parse(stub.last().body!)).toEqual({
      payment_source: { token: { id: 'SETUP-1', type: 'SETUP_TOKEN' } },
    });
    const trail = await audit.list(db, ids.harbor, { limit: 5 });
    expect(trail.entries.map((e) => [e.action, e.paypalCall])).toEqual([
      ['VAULT_TOKEN_CREATED', 'POST /v3/vault/payment-tokens'],
      ['VAULT_SETUP_STARTED', 'POST /v3/vault/setup-tokens'],
    ]);
    // Once saved, both calls answer from Terms without PayPal.
    const calls = stub.apiCalls().length;
    expect((await vault.startSetup(ids.harbor)).status).toBe('ACTIVE');
    expect((await vault.completeSetup(ids.harbor)).status).toBe('ACTIVE');
    expect(stub.apiCalls()).toHaveLength(calls);
  });

  it('replays a setup whose answer was lost, with the same request id', async () => {
    let n = 0;
    const stub = routePayPal({
      'POST /v3/vault/setup-tokens': () =>
        ++n === 1
          ? dropConnection(new URL('x:'), new Request('x:'))
          : jsonResponse(201, setupToken('PAYER_ACTION_REQUIRED')),
    });
    const started = await services(stub.fetch).vault.startSetup(ids.harbor);
    expect(started.approveUrl).not.toBeNull();
    const [first, second] = stub.apiCalls();
    expect(second!.request.headers.get('paypal-request-id')).toBe(
      first!.request.headers.get('paypal-request-id'),
    );
    expect((await ledger.get(db, `vault-setup:${started.vaultTokenId}`))!.status).toBe('SUCCEEDED');
  });

  it('marks the setup FAILED when PayPal refuses it, and reports unknown outcomes', async () => {
    const refused = routePayPal({
      'POST /v3/vault/setup-tokens': [
        jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Bad return URL')),
      ],
    });
    await expect(services(refused.fetch).vault.startSetup(ids.harbor)).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    expect((await db.vaultToken.findFirstOrThrow({ where: { clientId: ids.harbor } })).status).toBe(
      'FAILED',
    );

    const lost = routePayPal({ 'POST /v3/vault/setup-tokens': dropConnection });
    await expect(services(lost.fetch).vault.startSetup(ids.juniper)).rejects.toThrow(
      'may have started the setup',
    );
  });

  it('handles incomplete answers, refusals and lost answers when saving the token', async () => {
    // A setup answer without an approve link cannot be used: outcome unknown.
    const noLink = routePayPal({
      'POST /v3/vault/setup-tokens': [
        jsonResponse(201, { id: 'SETUP-1', status: 'CREATED', links: [] }),
      ],
    });
    await expect(services(noLink.fetch).vault.startSetup(ids.harbor)).rejects.toThrow(
      'may have started the setup',
    );

    // The exchange: refused, then lost, then answered without an id.
    await resetDb(db);
    ids = await seedScenario(db);
    await db.vaultToken.create({
      data: { clientId: ids.harbor, status: 'PENDING', setupTokenId: 'SETUP-1' },
    });
    const approved = () => jsonResponse(200, setupToken('APPROVED'));
    const refused = routePayPal({
      'GET /v3/vault/setup-tokens/SETUP-1': () => approved(),
      'POST /v3/vault/payment-tokens': [
        jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Setup token expired')),
      ],
    });
    await expect(services(refused.fetch).vault.completeSetup(ids.harbor)).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    const lost = routePayPal({
      'GET /v3/vault/setup-tokens/SETUP-1': () => approved(),
      'POST /v3/vault/payment-tokens': dropConnection,
    });
    await expect(services(lost.fetch).vault.completeSetup(ids.harbor)).rejects.toThrow(
      'may have saved',
    );
    const noId = routePayPal({
      'GET /v3/vault/setup-tokens/SETUP-1': () => approved(),
      'POST /v3/vault/payment-tokens': [jsonResponse(201, { customer: { id: 'C' } })],
    });
    await expect(services(noId.fetch).vault.completeSetup(ids.harbor)).rejects.toThrow(
      'may have saved',
    );
    expect((await db.vaultToken.findFirstOrThrow({ where: { clientId: ids.harbor } })).status).toBe(
      'PENDING',
    );
  });

  it('reports a setup token PayPal no longer has as not found', async () => {
    await db.vaultToken.create({
      data: { clientId: ids.harbor, status: 'PENDING', setupTokenId: 'GONE' },
    });
    // The Vault 404 body observed in the sandbox fails the SDK schema (links without rel).
    const stub = routePayPal({
      'GET /v3/vault/setup-tokens/GONE': [
        jsonResponse(404, {
          name: 'RESOURCE_NOT_FOUND',
          message: 'The specified resource does not exist.',
          debug_id: 'd',
          links: [{ href: 'https://developer.paypal.com' }],
        }),
      ],
    });
    await expect(services(stub.fetch).vault.startSetup(ids.harbor)).rejects.toSatisfy(
      isAppError('NOT_FOUND'),
    );
  });

  it('only serves clients, and needs a setup before completing one', async () => {
    const { vault } = services(noPayPal().fetch);
    await expect(vault.startSetup(ids.maya)).rejects.toSatisfy(isAppError('NOT_FOUND'));
    await expect(vault.completeSetup(ids.harbor)).rejects.toSatisfy(isAppError('CONFLICT'));
  });
});

// ------------------------------------------------------------------------------- payments

async function awaitingDeal(amountEarly = '1750.00') {
  const { deal } = await seedDeal(db, ids);
  const step = (
    to: Parameters<DealStore['transition']>[0]['to'],
    actor: Parameters<DealStore['transition']>[0]['actor'],
  ) => deals.transition({ dealId: deal.id, to, actor, reason: 'test' });
  await step('APPROVED', 'OWNER');
  await step('SENT', 'SUPPLIER_AGENT');
  await deals.transition({
    dealId: deal.id,
    to: 'AGREED',
    actor: 'CLIENT_AGENT',
    reason: 'accepted',
    patch: {
      agreedTerms: { amountEarly, discountPct: '1.20', payBy: TODAY, remainderDue: '2026-12-03' },
    },
  });
  await step('INVOICE_UPDATED', 'SYSTEM');
  await step('AWAITING_PAYMENT', 'SYSTEM');
  return deal.id;
}

async function savedMethod(clientId = ids.harbor) {
  await db.vaultToken.create({
    data: {
      clientId,
      status: 'ACTIVE',
      setupTokenId: `S-${clientId}`,
      paypalPaymentTokenId: `TOKEN-${clientId}`,
    },
  });
}

const RECORD = '/v2/invoicing/invoices/INV2-TEST-1043/payments';

describe('PaymentService.payWithVault (Postgres, fake PayPal through the SDK)', () => {
  it('pays the agreed amount to the app owner from the client’s own token, then records it', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    const stub = routePayPal({
      'POST /v2/checkout/orders': [jsonResponse(201, order('COMPLETED'))],
      [`POST ${RECORD}`]: [jsonResponse(200, { payment_id: 'EXTR-1' })],
    });
    const r = await services(stub.fetch).payments.payWithVault(dealId);
    expect(r).toMatchObject({
      orderId: 'ORDER-1',
      captureId: 'CAPTURE-1',
      captureStatus: 'COMPLETED',
      amountCents: dollars(1729),
    });
    // Paid is PayPal's word to give (webhook or read), not this call's.
    expect(r.deal.state).toBe('AWAITING_PAYMENT');
    expect(r.deal).toMatchObject({ paypalOrderId: 'ORDER-1', paypalCaptureId: 'CAPTURE-1' });

    const create = stub.apiCalls()[0]!;
    const write = await ledger.get(db, `order:${dealId}`);
    expect(write).toMatchObject({ status: 'SUCCEEDED', resultRef: 'ORDER-1' });
    expect(create.request.headers.get('paypal-request-id')).toBe(write!.requestId);
    expect(create.request.headers.get('prefer')).toBe('return=representation');
    const body = JSON.parse(create.body!) as {
      purchase_units: Record<string, unknown>[];
      payment_source: unknown;
    };
    expect(body.payment_source).toEqual({ paypal: { vault_id: `TOKEN-${ids.harbor}` } });
    expect(body.purchase_units[0]).toEqual({
      amount: { currency_code: 'USD', value: '1729.00' },
      invoice_id: `1043-${dealId}`,
      custom_id: dealId,
      description: 'Early payment of invoice 1043',
    });
    expect(body.purchase_units[0]).not.toHaveProperty('payee'); // I-2

    expect(await db.paymentRecord.findFirstOrThrow({ where: { dealId } })).toMatchObject({
      status: 'RECORDED',
      captureId: 'CAPTURE-1',
      invoicePaymentId: 'EXTR-1',
    });
    const trail = await audit.list(db, ids.harbor, { limit: 10, dealId });
    expect(trail.entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['ORDER_CAPTURED', 'PAYMENT_RECORDED']),
    );

    // A second attempt never pays twice.
    await expect(services(stub.fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      isAppError('CONFLICT'),
    );
    expect(stub.apiCalls().filter((c) => c.url.pathname === '/v2/checkout/orders')).toHaveLength(1);
  });

  it('replays a lost order with the same request id instead of paying again', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    let n = 0;
    const stub = routePayPal({
      'POST /v2/checkout/orders': () =>
        ++n === 1
          ? jsonResponse(500, paypalError('INTERNAL_SERVER_ERROR', 'x'))
          : jsonResponse(201, order('COMPLETED')),
      [`POST ${RECORD}`]: [jsonResponse(200, { payment_id: 'EXTR-1' })],
    });
    const r = await services(stub.fetch).payments.payWithVault(dealId);
    expect(r.orderId).toBe('ORDER-1');
    const [first, second] = stub.apiCalls();
    expect(second!.request.headers.get('paypal-request-id')).toBe(
      first!.request.headers.get('paypal-request-id'),
    );
  });

  it('keeps the payment UNKNOWN when even the replay gets no answer', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    const stub = routePayPal({ 'POST /v2/checkout/orders': dropConnection });
    await expect(services(stub.fetch).payments.payWithVault(dealId)).rejects.toThrow(
      'may have taken the payment',
    );
    expect((await ledger.get(db, `order:${dealId}`))!.status).toBe('UNKNOWN');
    expect((await deals.get(db, dealId)).state).toBe('AWAITING_PAYMENT');
  });

  it('captures an order PayPal left approved', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    const stub = routePayPal({
      'POST /v2/checkout/orders': [jsonResponse(201, order('APPROVED'))],
      'POST /v2/checkout/orders/ORDER-1/capture': [
        jsonResponse(201, order('COMPLETED', 'PENDING')),
      ],
    });
    const r = await services(stub.fetch).payments.payWithVault(dealId);
    expect(r.captureStatus).toBe('PENDING');
    // A pending capture is not recorded on the invoice yet.
    expect(stub.apiCalls().map((c) => c.url.pathname)).toEqual([
      '/v2/checkout/orders',
      '/v2/checkout/orders/ORDER-1/capture',
    ]);
    expect((await ledger.get(db, 'capture:ORDER-1'))!.status).toBe('SUCCEEDED');
  });

  it('needs a person’s approval above the auto-pay limit (I-4)', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    await db.clientPolicy.update({
      where: { businessId: ids.harbor },
      data: { autoPayLimitCents: dollars(1000) },
    });
    await expect(services(noPayPal().fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      (e) =>
        e instanceof AppError &&
        e.code === 'POLICY_BLOCKED' &&
        e.policyChecks?.[0]?.result === 'needs_approval',
    );
    // An approval for a different amount does not count.
    const approval = (amount: number) =>
      db.approval.create({
        data: {
          type: 'CLIENT_PAYMENT',
          subjectType: 'DEAL',
          subjectId: dealId,
          requestedFrom: 'CLIENT_HUMAN',
          businessId: ids.harbor,
          decision: 'APPROVED',
          title: 'Pay Maya Studio',
          summary: 'test',
          dealId,
          paymentAmountCents: dollars(amount),
        },
      });
    await approval(1500);
    await expect(services(noPayPal().fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      isAppError('POLICY_BLOCKED'),
    );
    await approval(1729);
    const stub = routePayPal({
      'POST /v2/checkout/orders': [jsonResponse(201, order('COMPLETED'))],
      [`POST ${RECORD}`]: [jsonResponse(200, { payment_id: 'EXTR-1' })],
    });
    expect((await services(stub.fetch).payments.payWithVault(dealId)).captureId).toBe('CAPTURE-1');
  });

  it('refuses without the client’s own saved method, or before the invoice carries the terms', async () => {
    const dealId = await awaitingDeal();
    await savedMethod(ids.juniper); // I-1: someone else's token does not count
    const none = noPayPal();
    await expect(services(none.fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      isAppError('CONFLICT'),
    );

    const { deal } = await seedDeal(db, ids);
    await expect(services(none.fetch).payments.payWithVault(deal.id)).rejects.toSatisfy(
      isAppError('CONFLICT'),
    );
    await expect(services(none.fetch).payments.payWithVault('missing')).rejects.toSatisfy(
      isAppError('NOT_FOUND'),
    );
    expect(none.calls).toHaveLength(0);
  });

  it('treats an answer it cannot use as an unknown outcome, never as paid', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    const noId = routePayPal({
      'POST /v2/checkout/orders': [jsonResponse(201, { status: 'COMPLETED' })],
    });
    await expect(services(noId.fetch).payments.payWithVault(dealId)).rejects.toThrow(
      'may have taken the payment',
    );
    expect((await ledger.get(db, `order:${dealId}`))!.status).toBe('UNKNOWN');

    const noCapture = routePayPal({
      'POST /v2/checkout/orders': [
        jsonResponse(201, { ...order('COMPLETED'), purchase_units: [{}] }),
      ],
    });
    await expect(services(noCapture.fetch).payments.payWithVault(dealId)).rejects.toThrow(
      'may have taken the payment',
    );
    expect(await db.paymentRecord.count()).toBe(0);
  });

  it('reports a capture PayPal refuses or never answers', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    const refused = routePayPal({
      'POST /v2/checkout/orders': [jsonResponse(201, order('APPROVED'))],
      'POST /v2/checkout/orders/ORDER-1/capture': [
        jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Instrument declined')),
      ],
    });
    await expect(services(refused.fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    const lost = routePayPal({
      'POST /v2/checkout/orders': [jsonResponse(201, order('APPROVED'))],
      'POST /v2/checkout/orders/ORDER-1/capture': dropConnection,
    });
    await expect(services(lost.fetch).payments.payWithVault(dealId)).rejects.toThrow(
      'may have captured',
    );
  });

  it('needs the client’s payment policy', async () => {
    const dealId = await awaitingDeal();
    await db.clientPolicy.delete({ where: { businessId: ids.harbor } });
    await expect(services(noPayPal().fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      isAppError('CONFLICT'),
    );
  });

  it('fails the deal when PayPal refuses the payment', async () => {
    const dealId = await awaitingDeal();
    await savedMethod();
    const stub = routePayPal({
      'POST /v2/checkout/orders': [
        jsonResponse(
          422,
          paypalError('UNPROCESSABLE_ENTITY', 'The instrument presented was declined'),
        ),
      ],
    });
    await expect(services(stub.fetch).payments.payWithVault(dealId)).rejects.toSatisfy(
      isAppError('VALIDATION_FAILED'),
    );
    expect((await deals.get(db, dealId)).state).toBe('FAILED');
    expect(await ledger.get(db, `order:${dealId}`)).toBeNull();
  });
});
