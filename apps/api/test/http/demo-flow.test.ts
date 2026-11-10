/**
 * The CONTEXT.md demo end to end through the real API, the deal runner, the negotiation engine and
 * the PayPal services, with PayPal faked at the network level (every request is recorded and
 * asserted). This is the backend half of Phase 9's E2E run; the sandbox run uses the same code.
 */
import {
  ClientPolicyResponse,
  DealDetail,
  DecideApprovalResponse,
  GoalResponse,
  ListApprovalsResponse,
  ListClientOffersResponse,
  PlanResponse,
  WebhookAckResponse,
} from '@terms/shared';
import type express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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

async function signedIn(app: express.Express, businessId: string) {
  const agent = request.agent(app);
  await agent.post('/api/session').send({ businessId }).expect(201);
  return agent;
}

/** A PayPal invoice in wire shape. */
function invoice(
  id: string,
  number: string,
  total: string,
  o: { discount?: string; minimum?: string; status?: string; paid?: string } = {},
) {
  const paid = o.paid ?? '0.00';
  return {
    id,
    status: o.status ?? 'SENT',
    detail: {
      invoice_number: number,
      currency_code: 'USD',
      metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${number}` },
    },
    amount: {
      currency_code: 'USD',
      value: total,
      breakdown:
        o.discount === undefined
          ? {}
          : {
              discount: {
                invoice_discount: { amount: { currency_code: 'USD', value: `-${o.discount}` } },
              },
            },
    },
    due_amount: { currency_code: 'USD', value: (Number(total) - Number(paid)).toFixed(2) },
    payments: { paid_amount: { currency_code: 'USD', value: paid } },
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

const SENTENCE =
  "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.";

describe('the demo, end to end through the API (fake PayPal at the network level)', () => {
  it('goal → plan → approve → negotiate → owner → invoices → agent payment → webhooks → goal met', async () => {
    const paypal = routePayPal({
      'POST /v2/invoicing/invoices/INV2-TEST-1038/remind': [new Response(null, { status: 204 })],
      'GET /v2/invoicing/invoices/INV2-TEST-1041': [
        jsonResponse(200, invoice('INV2-TEST-1041', '1041', '5000.00')),
      ],
      'PUT /v2/invoicing/invoices/INV2-TEST-1041': [
        jsonResponse(200, invoice('INV2-TEST-1041', '1041', '4960.00', { discount: '40.00' })),
      ],
      'GET /v2/invoicing/invoices/INV2-TEST-1043': [
        jsonResponse(200, invoice('INV2-TEST-1043', '1043', '7500.00')),
      ],
      'PUT /v2/invoicing/invoices/INV2-TEST-1043': [
        jsonResponse(
          200,
          invoice('INV2-TEST-1043', '1043', '7479.00', { discount: '21.00', minimum: '1729.00' }),
        ),
      ],
      'POST /v2/checkout/orders': () =>
        jsonResponse(201, {
          id: 'ORDER-H',
          status: 'COMPLETED',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAPTURE-H',
                    status: 'COMPLETED',
                    amount: { currency_code: 'USD', value: '1729.00' },
                  },
                ],
              },
            },
          ],
        }),
      'POST /v2/invoicing/invoices/INV2-TEST-1043/payments': [
        jsonResponse(200, { payment_id: 'EXTR-H' }),
      ],
      'POST /v1/notifications/verify-webhook-signature': () =>
        jsonResponse(200, { verification_status: 'SUCCESS' }),
    });
    const { app, services } = testApp(db, { now, paypalFetch: paypal.fetch });
    // Harbor saved its PayPal method earlier (spike S5 flow); Juniper did not.
    await db.vaultToken.create({
      data: {
        clientId: ids.harbor,
        status: 'ACTIVE',
        setupTokenId: 'SETUP-H',
        paypalPaymentTokenId: 'TOKEN-H',
      },
    });

    // 1. Maya states her goal, plans and approves with her $60 ceiling.
    const maya = await signedIn(app, ids.maya);
    const { goal } = GoalResponse.parse(
      (await maya.post('/api/goals').send({ text: SENTENCE }).expect(201)).body,
    );
    const { plan } = PlanResponse.parse(
      (await maya.post(`/api/goals/${goal.id}/plan`).send({}).expect(201)).body,
    );
    await maya.post(`/api/plans/${plan.id}/approve`).send({ costCeiling: '60.00' }).expect(200);
    await services.runner.drain();

    const byNumber = async () =>
      Object.fromEntries(
        (await db.deal.findMany({ where: { planId: plan.id }, include: { invoice: true } })).map(
          (d) => [d.invoice.number, d],
        ),
      );
    let deals = await byNumber();
    const harborDealId = deals['1043']!.id;
    // Oak Street: a reminder went out through PayPal. Juniper: agreed at 0.8%, invoice updated,
    // waiting for its person ($4,960 > $3,000). Harbor: countered 1.5%, waiting for Maya.
    expect(deals['1038']!.state).toBe('SENT');
    expect(deals['1041']!.state).toBe('AWAITING_PAYMENT');
    expect(deals['1043']!.state).toBe('NEEDS_OWNER');

    // 2. Maya approves going $1 over; the counter goes out, Harbor accepts, the invoice carries
    //    the terms, and Harbor's agent pays $1,729 from its saved method.
    const ownerAsk = ListApprovalsResponse.parse(
      (await maya.get('/api/approvals?decision=PENDING').expect(200)).body,
    );
    expect(ownerAsk.approvals.map((a) => a.title)).toEqual(['Counter Harbor & Co at 1.20%']);
    await maya
      .post(`/api/approvals/${ownerAsk.approvals[0]!.id}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    await services.runner.drain();
    const harborDeal = DealDetail.parse(
      (await maya.get(`/api/deals/${harborDealId}`).expect(200)).body,
    );
    expect(harborDeal).toMatchObject({
      state: 'AWAITING_PAYMENT',
      agreedTerms: { amountEarly: '1750.00', discountPct: '1.20' },
      paypal: { orderId: 'ORDER-H', captureId: 'CAPTURE-H', invoicePaymentId: 'EXTR-H' },
    });
    const order = paypal.apiCalls().find((c) => c.url.pathname === '/v2/checkout/orders')!;
    expect(JSON.parse(order.body!)).toMatchObject({
      payment_source: { paypal: { vault_id: 'TOKEN-H' } },
      purchase_units: [{ amount: { value: '1729.00' }, custom_id: harborDealId }],
    });

    // Committed is $6,689 ≥ $6,510: the goal is met even before PayPal confirms the money.
    const met = PlanResponse.parse((await maya.get(`/api/plans/${plan.id}`).expect(200)).body);
    expect(met.plan.summary).toMatchObject({
      committed: '6689.00',
      costSoFar: '61.00',
      goalMet: true,
      paid: '0.00',
    });
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).status).toBe('MET');

    // 3. PayPal confirms Harbor's capture (verified webhook): PARTIALLY_PAID.
    const capture = {
      id: 'WH-CAPTURE-H',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      create_time: '2026-11-09T15:05:00Z',
      resource: {
        id: 'CAPTURE-H',
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: '1729.00' },
        custom_id: harborDealId,
      },
    };
    const ack = await request(app)
      .post('/api/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(capture))
      .expect(200);
    expect(WebhookAckResponse.parse(ack.body)).toEqual({ received: true, duplicate: false });
    expect((await byNumber())['1043']!.state).toBe('PARTIALLY_PAID');
    const again = await request(app)
      .post('/api/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(capture));
    expect(again.body).toEqual({ received: true, duplicate: true });

    // 4. Juniper's person approves the $4,960 payment; with no saved method, they pay the invoice.
    const juniper = await signedIn(app, ids.juniper);
    const offers = ListClientOffersResponse.parse(
      (await juniper.get('/api/client/offers').expect(200)).body,
    );
    expect(offers.offers[0]).toMatchObject({
      payNow: '4960.00',
      impliedAnnualRate: '16.4',
      state: 'AWAITING_PAYMENT',
    });
    const pay = ListApprovalsResponse.parse(
      (await juniper.get('/api/approvals?type=CLIENT_PAYMENT').expect(200)).body,
    );
    const decided = DecideApprovalResponse.parse(
      (
        await juniper
          .post(`/api/approvals/${pay.approvals[0]!.id}`)
          .send({ decision: 'APPROVED' })
          .expect(200)
      ).body,
    );
    expect(decided.paypalApprovalUrl).toBe('https://www.sandbox.paypal.com/invoice/p/#1041');
    await request(app)
      .post('/api/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          id: 'WH-PAID-J',
          event_type: 'INVOICING.INVOICE.PAID',
          create_time: '2026-11-09T15:20:00Z',
          resource: {
            invoice: invoice('INV2-TEST-1041', '1041', '4960.00', {
              discount: '40.00',
              status: 'PAID',
              paid: '4960.00',
            }),
          },
        }),
      )
      .expect(200);
    deals = await byNumber();
    expect(deals['1041']!.state).toBe('PAID');

    // Paid now counts what PayPal confirmed: $4,960 + $1,729.
    const done = PlanResponse.parse((await maya.get(`/api/plans/${plan.id}`).expect(200)).body);
    expect(done.plan.summary).toMatchObject({ paid: '6689.00', committed: '6689.00' });

    // Every PayPal write carried a PayPal-Request-Id; nothing was sent to Pinecrest or Birch.
    for (const call of paypal
      .apiCalls()
      .filter((c) => c.request.method !== 'GET' && !c.url.pathname.includes('verify'))) {
      expect(call.request.headers.get('paypal-request-id'), call.url.pathname).toMatch(
        /^[0-9a-f-]{36}/,
      );
    }
    expect(
      paypal
        .apiCalls()
        .some((c) => c.url.pathname.includes('1039') || c.url.pathname.includes('1042')),
    ).toBe(false);
    // Harbor sees its own policy unchanged by any of this.
    const harbor = await signedIn(app, ids.harbor);
    expect(
      ClientPolicyResponse.parse((await harbor.get('/api/client/policy')).body).policy.autoPayLimit,
    ).toBe('2000.00');
  });
});
