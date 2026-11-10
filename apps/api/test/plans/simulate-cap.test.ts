import { dollars } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { isoToDate } from '../../src/mappers.js';
import { PlanService } from '../../src/plans/plan-service.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { FRIDAY, type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const now = () => new Date('2026-11-09T15:00:00Z');
const plans = new PlanService(db, audit, new DealStore(db, audit), now);
let ids: ScenarioIds;

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const demoGoal = () =>
  db.goal.create({
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

describe('PlanService.simulateCap', () => {
  it('matches the real planner at the goal’s own cap, and saves nothing', async () => {
    const goal = await demoGoal();
    const sim = await plans.simulateCap(goal.id, ids.maya, 120);
    const planId = await plans.createPlan(goal.id);
    const real = await plans.getView(planId, ids.maya);
    expect(sim.maxDiscountPct).toBe('1.20');
    expect(sim.target).toBe(real.summary.target);
    expect(sim.plannedCommitted).toBe(real.summary.plannedCommitted);
    expect(sim.plannedCost).toBe(real.summary.plannedCost);
    expect(sim.offers.map((o) => [o.invoiceNumber, o.client])).toEqual(
      real.items
        .filter((i) => i.rank === 'PRIMARY' && i.countsTowardGoal)
        .map((i) => [i.invoiceNumber, i.client.name]),
    );

    await db.plan.deleteMany();
    await db.goal.update({ where: { id: goal.id }, data: { status: 'DRAFT' } });
    const before = await db.plan.count();
    await plans.simulateCap(goal.id, ids.maya, 50);
    expect(await db.plan.count()).toBe(before);
    expect(await db.planItem.count()).toBe(0);
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).status).toBe('DRAFT');
  });

  it('shows what a different cap would do', async () => {
    const goal = await demoGoal();
    const base = await plans.simulateCap(goal.id, ids.maya, 120);
    const tight = await plans.simulateCap(goal.id, ids.maya, 10);
    expect(tight.maxDiscountPct).toBe('0.10');
    expect(tight.offers.every((o) => Number(o.discountPct ?? 0) <= 0.1)).toBe(true);
    expect(tight).not.toEqual(base);
    expect(base.offers.length).toBeGreaterThan(0);
    expect(base.offers[0]).toMatchObject({
      action: expect.any(String) as unknown,
      cost: expect.any(String) as unknown,
    });
  });

  it('is for the goal’s own supplier only', async () => {
    const goal = await demoGoal();
    await expect(plans.simulateCap(goal.id, ids.harbor, 120)).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === 'NOT_FOUND',
    );
    await expect(plans.simulateCap('no-such-goal', ids.maya, 120)).rejects.toSatisfy(
      (e) => e instanceof AppError && e.code === 'NOT_FOUND',
    );
  });
});
