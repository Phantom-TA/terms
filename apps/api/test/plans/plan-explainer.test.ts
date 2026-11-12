import { dollars, GoalResponse, PlanResponse } from '@terms/shared';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AiPlanExplainer } from '../../src/ai/explainer-role.js';
import { AiRoleError } from '../../src/ai/runner.js';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { EventBus } from '../../src/http/events.js';
import { createLogger } from '../../src/logger.js';
import { isoToDate } from '../../src/mappers.js';
import { PlanExplainer } from '../../src/plans/plan-explainer.js';
import { PlanService } from '../../src/plans/plan-service.js';
import { forRole, ScriptedRunner } from '../helpers/ai.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { FRIDAY, type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
const now = () => new Date('2026-11-09T15:00:00Z');
const plans = new PlanService(db, audit, deals, now);
let ids: ScenarioIds;

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function draftPlan(): Promise<string> {
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
  return plans.createPlan(goal.id);
}

function explainerWith(runner: ScriptedRunner) {
  const events = new EventBus(db, now);
  const role = new AiPlanExplainer(runner);
  return { explainer: new PlanExplainer(db, plans, role, events, createLogger('silent')), events };
}

const say = (explanation: string) => ({ explanation });

describe('PlanExplainer', () => {
  it('writes an explanation on every row and tells the owner', async () => {
    const planId = await draftPlan();
    const runner = forRole('plan-explainer', () => say('The cheapest way to cover the gap.'));
    const { explainer, events } = explainerWith(runner);
    const rows = await db.planItem.count({ where: { planId } });
    expect(await explainer.explainPlan(planId)).toBe(rows);
    expect(await db.planItem.count({ where: { planId, explanation: null } })).toBe(0);
    const types = (await db.eventLog.findMany({ where: { businessId: ids.maya } })).map(
      (e) => e.type,
    );
    expect(types).toEqual(['plan.updated']);
    expect(events).toBeDefined();
    // Rows that already have one are left alone.
    expect(await explainer.explainPlan(planId)).toBe(0);
    expect(runner.callsTo('plan-explainer')).toHaveLength(rows);
  });

  it('leaves rows to the planner’s reason when the model fails or invents a figure', async () => {
    const planId = await draftPlan();
    const failing = explainerWith(
      new ScriptedRunner((call) => new AiRoleError('provider', call.role, 'down')),
    );
    expect(await failing.explainer.explainPlan(planId)).toBe(0);
    const inventing = explainerWith(
      forRole('plan-explainer', () => say('A 7% discount would be generous.')),
    );
    expect(await inventing.explainer.explainPlan(planId)).toBe(0);
    expect(await db.planItem.count({ where: { planId, explanation: { not: null } } })).toBe(0);
    expect(await db.eventLog.count({ where: { businessId: ids.maya } })).toBe(0);
  });

  it('does not write a stale explanation over a row the owner changed meanwhile', async () => {
    const planId = await draftPlan();
    const harborItem = await db.planItem.findFirstOrThrow({
      where: { planId, invoice: { clientId: ids.harbor }, rank: 'PRIMARY' },
    });
    const runner = forRole('plan-explainer', () => {
      return say('Old explanation.');
    });
    // The owner edits Harbor's row while its explanation is being written.
    const racing = new AiPlanExplainer(runner);
    const original = racing.explain.bind(racing);
    racing.explain = async (item, context) => {
      const text = await original(item, context);
      if (item.id === harborItem.id) {
        await db.planItem.update({
          where: { id: harborItem.id },
          data: { reason: 'Edited by the owner' },
        });
      }
      return text;
    };
    const explainer = new PlanExplainer(
      db,
      plans,
      racing,
      new EventBus(db, now),
      createLogger('silent'),
    );
    const rows = await db.planItem.count({ where: { planId } });
    expect(await explainer.explainPlan(planId)).toBe(rows - 1);
    expect(
      (await db.planItem.findUniqueOrThrow({ where: { id: harborItem.id } })).explanation,
    ).toBeNull();
  });

  it('start() runs in the background and settle() waits for it; a crash is logged, not thrown', async () => {
    const planId = await draftPlan();
    const { explainer } = explainerWith(forRole('plan-explainer', () => say('Cheapest cover.')));
    explainer.start(planId);
    await explainer.settle();
    expect(await db.planItem.count({ where: { planId, explanation: null } })).toBe(0);
    explainer.start('no-such-plan'); // nothing to explain
    await explainer.settle();
    const broken = explainerWith(new ScriptedRunner(() => new Error('boom')));
    broken.explainer.start(planId);
    await db.planItem.updateMany({ where: { planId }, data: { explanation: null } });
    await broken.explainer.settle();
  });
});

describe('plan routes start the explainer', () => {
  it('shows rows at once, then their explanations; an edit is explained afresh', async () => {
    const runner = forRole('plan-explainer', () => say('The cheapest way to cover the gap.'));
    const { app, services } = testApp(db, { now, noPayPal: true, aiRunner: runner });
    const maya = request.agent(app);
    await maya.post('/api/session').send({ businessId: ids.maya }).expect(201);
    const { goal } = GoalResponse.parse(
      (
        await maya.post('/api/goals').send({
          text: "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.",
        })
      ).body,
    );
    const created = PlanResponse.parse(
      (await maya.post(`/api/goals/${goal.id}/plan`).send({ costCeiling: '60.00' }).expect(201))
        .body,
    );
    expect(created.plan.items.every((i) => i.explanation === null)).toBe(true);

    await services.explainer?.settle();
    const explained = PlanResponse.parse(
      (await maya.get(`/api/plans/${created.plan.id}`).expect(200)).body,
    );
    expect(
      explained.plan.items.every((i) => i.explanation === 'The cheapest way to cover the gap.'),
    ).toBe(true);

    const harborRow = explained.plan.items.find((i) => i.client.name === 'Harbor & Co');
    await maya
      .patch(`/api/plans/${created.plan.id}/items/${harborRow?.id ?? ''}`)
      .send({ discountPct: '0.50' })
      .expect(200);
    await services.explainer?.settle();
    expect(runner.callsTo('plan-explainer').length).toBeGreaterThan(explained.plan.items.length);
  });

  it('needs no AI: rows keep the planner’s reason', async () => {
    const { app, services } = testApp(db, { now, noPayPal: true });
    expect(services.explainer).toBeNull();
    const maya = request.agent(app);
    await maya.post('/api/session').send({ businessId: ids.maya }).expect(201);
    const { goal } = GoalResponse.parse(
      (await maya.post('/api/goals').send({ text: 'I need $6,200 by Friday. Max 1.2%.' })).body,
    );
    const { plan } = PlanResponse.parse(
      (await maya.post(`/api/goals/${goal.id}/plan`).send({ costCeiling: '60.00' }).expect(201))
        .body,
    );
    expect(plan.items.every((i) => i.explanation === null && i.reason.length > 0)).toBe(true);
  });
});
