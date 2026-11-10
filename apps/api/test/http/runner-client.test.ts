import {
  ApiErrorBody,
  dollars,
  ListApprovalsResponse,
  ListClientOffersResponse,
  VaultResponse,
  VaultSetupResponse,
} from '@terms/shared';
import type express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isoToDate } from '../../src/mappers.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { jsonResponse, routePayPal } from '../helpers/fake-fetch.js';
import { FRIDAY, type ScenarioIds, seedScenario, TODAY } from '../helpers/fixtures.js';

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

/** Plans and approves the demo through the services (no PayPal configured unless given). */
async function approvedDemo(services: ReturnType<typeof testApp>['services']) {
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
    },
  });
  const planId = await services.plans.createPlan(goal.id);
  await services.plans.approve(planId, ids.maya, dollars(60));
  return { goalId: goal.id, planId };
}

/** A client with an agent and an invoice that can serve as a backup row. */
/** amount at 0.8%: $2,500 costs $20, $5,000 costs $40. */
async function addBackupRow(planId: string, amountDollars: number) {
  const costDollars = (amountDollars * 80) / 10_000;
  const cedar = await db.business.create({
    data: { name: 'Cedar Co', slug: 'cedar-co', role: 'CLIENT', hasAgent: false },
  });
  const inv = await db.invoice.create({
    data: {
      paypalInvoiceId: 'INV2-TEST-1044',
      supplierId: ids.maya,
      clientId: cedar.id,
      number: '1044',
      amountCents: dollars(5000),
      amountDueCents: dollars(5000),
      dueDate: isoToDate('2026-11-29'),
      paypalStatus: 'SENT',
    },
  });
  await db.planItem.create({
    data: {
      planId,
      invoiceId: inv.id,
      action: amountDollars < 5000 ? 'PARTIAL_PAYMENT' : 'EARLY_DISCOUNT',
      rank: 'BACKUP',
      backupOrder: 1,
      discountBps: 80,
      amountEarlyCents: dollars(amountDollars),
      payBy: isoToDate(TODAY),
      costCents: dollars(costDollars),
      committedIfAgreedCents: dollars(amountDollars - costDollars),
      reasonCode: 'BACKUP',
      reason: 'backup',
    },
  });
  return cedar.id;
}

describe('deal runner: stop rule and backups', () => {
  it('withdraws open offers and their approvals once the goal is met', async () => {
    const { services } = testApp(db, { now, noPayPal: true });
    const { goalId, planId } = await approvedDemo(services);
    services.runner.kick(planId);
    await services.runner.drain();
    const harbor = await db.deal.findFirstOrThrow({ where: { planId, clientId: ids.harbor } });
    const juniper = await db.deal.findFirstOrThrow({ where: { planId, clientId: ids.juniper } });
    // Without PayPal, Juniper waits at AGREED (the invoice cannot be updated); Harbor needs Maya.
    expect([juniper.state, harbor.state]).toEqual(['AGREED', 'NEEDS_OWNER']);

    // The owner lowers the goal; Juniper's $4,960 alone now covers the $4,200 target.
    await db.goal.update({ where: { id: goalId }, data: { amountCents: dollars(4000) } });
    services.runner.kick(planId);
    await services.runner.drain();
    expect((await db.deal.findUniqueOrThrow({ where: { id: harbor.id } })).state).toBe('WITHDRAWN');
    expect((await db.approval.findFirstOrThrow({ where: { dealId: harbor.id } })).decision).toBe(
      'WITHDRAWN',
    );
    expect((await db.goal.findUniqueOrThrow({ where: { id: goalId } })).status).toBe('MET');
    expect(await db.eventLog.count({ where: { businessId: ids.maya, type: 'goal.met' } })).toBe(1);
    // The sent reminder is never withdrawn.
    const oak = await db.deal.findFirstOrThrow({ where: { planId, clientId: ids.oak } });
    expect(oak.state).toBe('APPROVED'); // no PayPal: not sent, and not withdrawn either
  });

  it('runs the next backup within the ceiling when an offer is declined', async () => {
    const { services } = testApp(db, { now, noPayPal: true });
    await db.clientPolicy.update({
      where: { businessId: ids.harbor },
      data: { neverPayEarly: [ids.maya] },
    });
    const { planId } = await approvedDemo(services);
    const cedar = await addBackupRow(planId, 2500); // $40 (Juniper) + $20 = $60, within the ceiling
    services.runner.kick(planId);
    await services.runner.drain();
    expect(
      (await db.deal.findFirstOrThrow({ where: { planId, clientId: ids.harbor } })).state,
    ).toBe('DECLINED');
    const backup = await db.deal.findFirstOrThrow({ where: { planId, clientId: cedar } });
    // A person at Cedar answers on the offer page: the offer is SENT and waits.
    expect(backup.state).toBe('SENT');
    const history = await db.dealTransition.findMany({
      where: { dealId: backup.id },
      orderBy: { at: 'asc' },
    });
    expect(history[0]).toMatchObject({
      toState: 'APPROVED',
      actor: 'OWNER',
      reason: 'Approved',
      privateReason: 'Backup within the approved ceiling',
      privateTo: 'SUPPLIER',
    });
  });

  it('asks the owner before a backup that crosses the ceiling, then runs it on approval', async () => {
    const { app, services } = testApp(db, { now, noPayPal: true });
    await db.clientPolicy.update({
      where: { businessId: ids.harbor },
      data: { neverPayEarly: [ids.maya] },
    });
    const { planId } = await approvedDemo(services);
    const cedar = await addBackupRow(planId, 5000); // $40 + $40 = $80 > $60
    services.runner.kick(planId);
    await services.runner.drain();
    expect(await db.deal.count({ where: { planId, clientId: cedar } })).toBe(0);
    const maya = await signedIn(app, ids.maya);
    const asks = ListApprovalsResponse.parse(
      (await maya.get('/api/approvals?type=BACKUP_OVER_CEILING').expect(200)).body,
    );
    expect(asks.approvals[0]).toMatchObject({
      title: 'Run backup: invoice 1044',
      costImpact: { overCeilingBy: '20.00' },
    });
    // Running again does not ask twice.
    services.runner.kick(planId);
    await services.runner.drain();
    expect(await db.approval.count({ where: { type: 'BACKUP_OVER_CEILING' } })).toBe(1);
    await maya
      .post(`/api/approvals/${asks.approvals[0]!.id}`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    await services.runner.drain();
    expect((await db.deal.findFirstOrThrow({ where: { planId, clientId: cedar } })).state).toBe(
      'SENT',
    );
  });
});

describe('client routes: offers, saved PayPal method, webhooks', () => {
  const setupToken = (status: string) => ({
    id: 'SETUP-1',
    status,
    links: [
      {
        href: 'https://www.sandbox.paypal.com/agreements/approve?approval_session_id=SETUP-1',
        rel: 'approve',
      },
    ],
  });

  it('saves the client’s PayPal method through setup and confirm', async () => {
    const paypal = routePayPal({
      'POST /v3/vault/setup-tokens': [jsonResponse(201, setupToken('PAYER_ACTION_REQUIRED'))],
      'GET /v3/vault/setup-tokens/SETUP-1': () => jsonResponse(200, setupToken('APPROVED')),
      'POST /v3/vault/payment-tokens': [
        jsonResponse(201, {
          id: 'TOKEN-1',
          customer: { id: 'C1' },
          payment_source: { paypal: { email_address: 'h@example.com' } },
        }),
      ],
    });
    const { app } = testApp(db, { now, paypalFetch: paypal.fetch });
    const harbor = await signedIn(app, ids.harbor);
    expect(
      VaultResponse.parse((await harbor.get('/api/client/vault').expect(200)).body).vault.status,
    ).toBe('NONE');
    const setup = VaultSetupResponse.parse(
      (await harbor.post('/api/client/vault/setup').send({}).expect(201)).body,
    );
    expect(setup).toEqual({
      setupTokenId: 'SETUP-1',
      approvalUrl: expect.stringContaining('SETUP-1') as string,
    });
    await harbor.post('/api/client/vault/confirm').send({ setupTokenId: 'OTHER' }).expect(409);
    const saved = VaultResponse.parse(
      (await harbor.post('/api/client/vault/confirm').send({ setupTokenId: 'SETUP-1' }).expect(200))
        .body,
    );
    expect(saved.vault).toMatchObject({
      status: 'ACTIVE',
      paymentTokenId: 'TOKEN-1',
      payerEmail: 'h@example.com',
    });
    await harbor.post('/api/client/vault/setup').send({}).expect(409);
    const maya = await signedIn(app, ids.maya);
    await maya.get('/api/client/vault').expect(403);
  });

  it('answers NOT_CONFIGURED for PayPal routes without credentials', async () => {
    const { app } = testApp(db, { now, noPayPal: true });
    const harbor = await signedIn(app, ids.harbor);
    expect(
      ApiErrorBody.parse((await harbor.post('/api/client/vault/setup').send({}).expect(503)).body)
        .error.code,
    ).toBe('NOT_CONFIGURED');
    await request(app)
      .post('/api/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(503);
  });

  it('rejects a webhook PayPal does not verify, and tells the owner', async () => {
    const paypal = routePayPal({
      'POST /v1/notifications/verify-webhook-signature': () =>
        jsonResponse(200, { verification_status: 'FAILURE' }),
    });
    const { app } = testApp(db, { now, paypalFetch: paypal.fetch });
    const forged = {
      id: 'WH-F',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      create_time: 'x',
      resource: { id: 'C' },
    };
    await request(app)
      .post('/api/webhooks/paypal')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(forged))
      .expect(401);
    const event = await db.eventLog.findFirstOrThrow({
      where: { businessId: ids.maya, type: 'webhook.received' },
    });
    expect(event.payload).toMatchObject({ data: { verified: false, duplicate: false } });
  });

  it('ranks a client’s offers by annual return and filters open and closed', async () => {
    const { app, services } = testApp(db, { now, noPayPal: true });
    const { planId } = await approvedDemo(services);
    services.runner.kick(planId);
    await services.runner.drain();
    const harbor = await signedIn(app, ids.harbor);
    const open = ListClientOffersResponse.parse(
      (await harbor.get('/api/client/offers').expect(200)).body,
    );
    expect(open.offers).toHaveLength(1);
    expect(open.offers[0]).toMatchObject({
      state: 'NEEDS_OWNER',
      terms: { discountPct: '1.50' },
      recommendation: 'ACCEPT',
    });
    expect(open.cashPosition).toMatchObject({
      available: '60000.00',
      buffer: '20000.00',
      spendableEarly: '40000.00',
    });
    const closed = ListClientOffersResponse.parse(
      (await harbor.get('/api/client/offers?status=CLOSED').expect(200)).body,
    );
    expect(closed.offers).toEqual([]);
    const oak = await signedIn(app, ids.oak);
    const oakOffers = ListClientOffersResponse.parse(
      (await oak.get('/api/client/offers?status=ALL').expect(200)).body,
    );
    expect(oakOffers).toMatchObject({ offers: [], cashPosition: { available: '0.00' } });
  });
});
