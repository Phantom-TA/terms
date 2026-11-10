import {
  CurrentGoalResponse,
  DealDetail,
  GoalResponse,
  ListDealsResponse,
  ListInvoicesResponse,
  PlanResponse,
  UpdatePlanItemResponse,
} from '@terms/shared';
import type express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
let ids: ScenarioIds;
// 10:00 on Monday 9 November in New York.
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

const SENTENCE =
  "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.";

describe('owner flow through the API: goal → plan → approve', () => {
  it('parses the goal, plans the demo, accepts an edit, approves, and lists deals and rows', async () => {
    const { app, services } = testApp(db, { now });
    const maya = await signedIn(app, ids.maya);

    // Nothing yet.
    expect(
      CurrentGoalResponse.parse((await maya.get('/api/goals/current').expect(200)).body),
    ).toEqual({ goal: null, plan: null });

    const { goal } = GoalResponse.parse(
      (await maya.post('/api/goals').send({ text: SENTENCE }).expect(201)).body,
    );
    expect(goal).toMatchObject({
      amount: '6200.00',
      deadline: '2026-11-13',
      maxDiscountPct: '1.20',
      openingDiscountPct: '0.80',
      bufferPct: '5.00',
      target: '6510.00',
      status: 'DRAFT',
      defaultedFields: ['bufferPct'],
    });
    expect(goal.doNotContact.map((d) => d.matchedName)).toEqual([
      'Pinecrest Dental',
      'Birch Legal',
    ]);
    await maya.post('/api/goals').send({ text: 'help' }).expect(400);

    // The owner edits a field, then plans.
    const edited = GoalResponse.parse(
      (await maya.patch(`/api/goals/${goal.id}`).send({ bufferPct: '5.00' }).expect(200)).body,
    );
    expect(edited.goal.defaultedFields).toEqual([]);
    const { plan } = PlanResponse.parse(
      (await maya.post(`/api/goals/${goal.id}/plan`).send({}).expect(201)).body,
    );
    expect(plan.summary).toMatchObject({
      target: '6510.00',
      plannedCost: '54.00',
      plannedCommitted: '6696.00',
    });

    const harborRow = plan.items.find((i) => i.invoiceNumber === '1043')!;
    const edit = UpdatePlanItemResponse.parse(
      (
        await maya
          .patch(`/api/plans/${plan.id}/items/${harborRow.id}`)
          .send({ discountPct: '1.00' })
          .expect(200)
      ).body,
    );
    expect(edit.plan.summary.plannedCost).toBe('57.50');
    await maya
      .patch(`/api/plans/${plan.id}/items/${harborRow.id}`)
      .send({ discountPct: '1.50' })
      .expect(422);

    const current = CurrentGoalResponse.parse(
      (await maya.get('/api/goals/current').expect(200)).body,
    );
    expect(current.plan?.id).toBe(plan.id);
    expect(
      PlanResponse.parse((await maya.get(`/api/plans/${plan.id}`).expect(200)).body).plan.id,
    ).toBe(plan.id);

    // Approve with the ceiling; nothing is sent, deals are APPROVED.
    await maya.post(`/api/plans/${plan.id}/approve`).send({ costCeiling: '50.00' }).expect(422);
    const approved = PlanResponse.parse(
      (await maya.post(`/api/plans/${plan.id}/approve`).send({ costCeiling: '60.00' }).expect(200))
        .body,
    );
    expect(approved.plan.status).toBe('APPROVED');
    await maya.patch(`/api/goals/${goal.id}`).send({ bufferPct: '6.00' }).expect(409);

    const deals = ListDealsResponse.parse((await maya.get('/api/deals').expect(200)).body);
    expect(deals.planId).toBe(plan.id);
    expect(deals.deals.map((d) => `${d.invoiceNumber}:${d.action}:${d.state}`)).toEqual([
      '1038:REMINDER:APPROVED',
      '1041:NEGOTIATE:APPROVED',
      '1043:NEGOTIATE:APPROVED',
    ]);
    expect(
      ListDealsResponse.parse((await maya.get('/api/deals?state=SENT').expect(200)).body).deals,
    ).toEqual([]);

    // The Workbench rows: one per open invoice, with its plan row, backups and deal.
    const rows = ListInvoicesResponse.parse((await maya.get('/api/invoices').expect(200)).body);
    expect(rows).toMatchObject({
      planId: plan.id,
      today: '2026-11-09',
      demo: true,
      lastSyncedAt: null,
    });
    expect(
      rows.rows.map((r) => [r.number, r.daysUntilDue, r.planItem?.action, r.deal?.state ?? null]),
    ).toEqual([
      ['1038', -6, 'REMINDER', 'APPROVED'],
      ['1039', 9, 'NONE', null],
      ['1042', 15, 'NONE', null],
      ['1041', 18, 'NEGOTIATE', 'APPROVED'],
      ['1043', 24, 'NEGOTIATE', 'APPROVED'],
    ]);

    // Live events were recorded for the owner.
    const types = (await db.eventLog.findMany({ where: { businessId: ids.maya } })).map(
      (e) => e.type,
    );
    expect(types).toEqual(
      expect.arrayContaining(['plan.updated', 'deal.updated', 'audit.appended']),
    );
    expect(services.config.env).toBe('test');
  });

  it('shows a deal to its supplier and its client only, with its transcript', async () => {
    const { app, services } = testApp(db, { now });
    const maya = await signedIn(app, ids.maya);
    const { goal } = GoalResponse.parse(
      (await maya.post('/api/goals').send({ text: SENTENCE })).body,
    );
    const { plan } = PlanResponse.parse(
      (await maya.post(`/api/goals/${goal.id}/plan`).send({ costCeiling: '60.00' })).body,
    );
    await maya.post(`/api/plans/${plan.id}/approve`).send({ costCeiling: '60.00' }).expect(200);
    const harborDeal = (
      await db.deal.findFirstOrThrow({ where: { planId: plan.id, clientId: ids.harbor } })
    ).id;
    await services.engine.runAgents(harborDeal); // Harbor counters; NEEDS_OWNER

    const detail = DealDetail.parse((await maya.get(`/api/deals/${harborDeal}`).expect(200)).body);
    expect(detail).toMatchObject({
      state: 'NEEDS_OWNER',
      round: 2,
      paypal: { invoiceId: 'INV2-TEST-1043' },
    });
    expect(detail.pendingApprovalId).not.toBeNull();
    expect(detail.messages.map((m) => `${m.from}>${m.to}:${m.type}`)).toEqual([
      'supplier:maya-studio>client:harbor-co:OFFER',
      'client:harbor-co>supplier:maya-studio:COUNTER',
    ]);
    expect(detail.history.map((h) => h.to)).toEqual([
      'APPROVED',
      'SENT',
      'COUNTERED',
      'NEEDS_OWNER',
    ]);
    expect(detail.approvals[0]).toMatchObject({ type: 'COUNTER_OVER_PLAN' });

    const harbor = await signedIn(app, ids.harbor);
    expect(
      DealDetail.parse((await harbor.get(`/api/deals/${harborDeal}`).expect(200)).body).id,
    ).toBe(harborDeal);
    const juniper = await signedIn(app, ids.juniper);
    await juniper.get(`/api/deals/${harborDeal}`).expect(404);
    await harbor.get('/api/deals').expect(403); // owner route
  });

  it('keeps one supplier out of another’s goals and plans', async () => {
    const { app } = testApp(db, { now });
    const rival = await db.business.create({
      data: { name: 'Rival', slug: 'rival', role: 'SUPPLIER' },
    });
    const maya = await signedIn(app, ids.maya);
    const { goal } = GoalResponse.parse(
      (await maya.post('/api/goals').send({ text: SENTENCE })).body,
    );
    const { plan } = PlanResponse.parse(
      (await maya.post(`/api/goals/${goal.id}/plan`).send({})).body,
    );
    const other = await signedIn(app, rival.id);
    await other.get(`/api/goals/${goal.id}`).expect(404);
    await other.post(`/api/goals/${goal.id}/plan`).send({}).expect(404);
    await other.get(`/api/plans/${plan.id}`).expect(404);
    await other.get(`/api/deals?planId=${plan.id}`).expect(404);
    await other.get(`/api/invoices?planId=${plan.id}`).expect(404);
    expect(
      ListInvoicesResponse.parse(
        (await other.get('/api/invoices?includeClosed=true').expect(200)).body,
      ).rows,
    ).toEqual([]);
  });
});
