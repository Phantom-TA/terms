import { dollars, Plan } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '../src/audit.js';
import { DealStore } from '../src/deals/deal-store.js';
import { AppError } from '../src/errors.js';
import { isoToDate } from '../src/mappers.js';
import { PlanService } from '../src/plans/plan-service.js';
import { createTestDb, resetDb } from './helpers/db.js';
import { FRIDAY, type ScenarioIds, seedScenario } from './helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
// 2026-11-09 15:00 UTC is 10:00 on Monday 9 Nov in New York (the businesses' time zone).
const service = new PlanService(db, audit, deals, () => new Date('2026-11-09T15:00:00Z'));

let ids: ScenarioIds;

async function createGoal() {
  return db.goal.create({
    data: {
      supplierId: ids.maya,
      rawText:
        "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.",
      amountCents: dollars(6200),
      deadline: isoToDate(FRIDAY),
      maxDiscountBps: 120,
      openingDiscountBps: 80,
      doNotContactIds: [ids.pinecrest, ids.birch],
      bufferBps: 500,
    },
  });
}

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const isAppError = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe('PlanService (Postgres)', () => {
  it('plans the demo scenario and serves a valid Workbench view', async () => {
    const goal = await createGoal();
    const planId = await service.createPlan(goal.id);
    const view = await service.getView(planId, ids.maya);
    expect(Plan.safeParse(view).success).toBe(true);

    expect(view.status).toBe('DRAFT');
    expect(view.costCeiling).toBe('60.00'); // from Maya's policy
    expect(view.summary).toMatchObject({
      gap: '6200.00',
      buffer: '310.00',
      target: '6510.00',
      plannedCommitted: '6696.00',
      plannedCost: '54.00',
      committed: '0.00',
      bestEffort: '1800.00',
      remaining: '6510.00',
      goalMet: false,
      shortfall: false,
    });
    const byNumber = Object.fromEntries(view.items.map((i) => [i.invoiceNumber, i]));
    expect(byNumber['1041']).toMatchObject({
      action: 'NEGOTIATE',
      discountPct: '0.80',
      amountEarly: '5000.00',
      daysEarly: 18,
      impliedAnnualRate: '16.4',
      countsTowardGoal: true,
    });
    expect(byNumber['1043']).toMatchObject({ amountEarly: '1750.00', impliedAnnualRate: '12.3' });
    expect(byNumber['1038']).toMatchObject({ action: 'REMINDER', countsTowardGoal: false });
    expect(byNumber['1039']).toMatchObject({ action: 'NONE', reasonCode: 'DO_NOT_CONTACT' });
    expect(byNumber['1042']).toMatchObject({ action: 'NONE', reasonCode: 'DO_NOT_CONTACT' });
    // Primary rows come in due-date order.
    expect(view.items.map((i) => i.invoiceNumber)).toEqual([
      '1038',
      '1039',
      '1042',
      '1041',
      '1043',
    ]);

    const goalAfter = await db.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(goalAfter.status).toBe('PLANNED');
    const entries = await audit.list(db, ids.maya, { limit: 10, action: 'PLAN_CREATED' });
    expect(entries.entries[0]!.summary).toBe('Plan commits $6,696.00 against $6,510.00 for $54.00');
  });

  it('replaces an earlier draft and hides plans from other businesses', async () => {
    const goal = await createGoal();
    const first = await service.createPlan(goal.id);
    const second = await service.createPlan(goal.id, dollars(70));
    expect((await db.plan.findUniqueOrThrow({ where: { id: first } })).status).toBe('CANCELLED');
    expect((await service.getView(second, ids.maya)).costCeiling).toBe('70.00');
    await expect(service.getView(second, ids.harbor)).rejects.toSatisfy(isAppError('NOT_FOUND'));
    await expect(service.createPlan('missing')).rejects.toSatisfy(isAppError('NOT_FOUND'));
  });

  it('lets the owner edit rows within policy and blocks edits that break it', async () => {
    const goal = await createGoal();
    const planId = await service.createPlan(goal.id);
    const view = await service.getView(planId, ids.maya);
    const harbor = view.items.find((i) => i.invoiceNumber === '1043')!;
    const pinecrest = view.items.find((i) => i.invoiceNumber === '1039')!;
    const oak = view.items.find((i) => i.invoiceNumber === '1038')!;

    const edited = await service.editItem(planId, harbor.id, ids.maya, {
      discountPct: '1.00',
      amountEarly: '2000.00',
    });
    const row = edited.plan.items.find((i) => i.id === harbor.id)!;
    expect(row).toMatchObject({
      action: 'NEGOTIATE',
      discountPct: '1.00',
      amountEarly: '2000.00',
      cost: '20.00',
      committedIfAgreed: '1980.00',
      editedByOwner: true,
      reasonCode: 'OWNER_EDIT',
    });
    expect(edited.policyChecks.every((c) => c.result === 'pass')).toBe(true);
    expect(edited.plan.summary.plannedCost).toBe('60.00');

    // Above the 1.2% maximum: hard block.
    await expect(
      service.editItem(planId, harbor.id, ids.maya, { discountPct: '1.50' }),
    ).rejects.toSatisfy(
      (e) =>
        e instanceof AppError &&
        e.code === 'POLICY_BLOCKED' &&
        e.policyChecks?.some((c) => c.rule === 'maxDiscount' && c.result === 'blocked') === true,
    );
    // Do-not-contact: even a reminder is blocked.
    await expect(
      service.editItem(planId, pinecrest.id, ids.maya, { action: 'REMINDER' }),
    ).rejects.toSatisfy(isAppError('POLICY_BLOCKED'));
    // Overdue invoices never get a discount.
    await expect(
      service.editItem(planId, oak.id, ids.maya, { action: 'EARLY_DISCOUNT' }),
    ).rejects.toSatisfy(isAppError('POLICY_BLOCKED'));
    // Shape rules.
    await expect(
      service.editItem(planId, oak.id, ids.maya, { action: 'NEGOTIATE' }),
    ).rejects.toSatisfy(isAppError('VALIDATION_FAILED'));
    await expect(
      service.editItem(planId, harbor.id, ids.maya, { amountEarly: '9000.00' }),
    ).rejects.toSatisfy(isAppError('POLICY_BLOCKED'));

    // Exclude a client, then switch Oak Street to no action.
    const excluded = await service.editItem(planId, harbor.id, ids.maya, { excluded: true });
    expect(excluded.plan.items.find((i) => i.id === harbor.id)).toMatchObject({
      action: 'NONE',
      reasonCode: 'OWNER_EXCLUDED',
      cost: '0.00',
    });
    expect(excluded.plan.summary.shortfall).toBe(true);
    const none = await service.editItem(planId, oak.id, ids.maya, { action: 'NONE' });
    expect(none.plan.summary.bestEffort).toBe('0.00');
    const back = await service.editItem(planId, oak.id, ids.maya, { action: 'REMINDER' });
    expect(back.plan.summary.bestEffort).toBe('1800.00');
  });

  it('validates human-client offer shapes', async () => {
    await db.business.update({ where: { id: ids.harbor }, data: { hasAgent: false } });
    const goal = await createGoal();
    const planId = await service.createPlan(goal.id);
    const view = await service.getView(planId, ids.maya);
    const harbor = view.items.find((i) => i.invoiceNumber === '1043')!;
    expect(harbor.action).toBe('PARTIAL_PAYMENT');
    await expect(
      service.editItem(planId, harbor.id, ids.maya, { action: 'EARLY_DISCOUNT' }),
    ).rejects.toSatisfy(isAppError('VALIDATION_FAILED'));
    await expect(
      service.editItem(planId, harbor.id, ids.maya, {
        action: 'PARTIAL_PAYMENT',
        amountEarly: '7500.00',
      }),
    ).rejects.toSatisfy(isAppError('VALIDATION_FAILED'));
    const full = await service.editItem(planId, harbor.id, ids.maya, { amountEarly: '7500.00' });
    expect(full.plan.items.find((i) => i.id === harbor.id)!.action).toBe('EARLY_DISCOUNT');
  });

  it('approves the plan: APPROVED deals for primary actions, nothing sent', async () => {
    const goal = await createGoal();
    const planId = await service.createPlan(goal.id);
    await expect(service.approve(planId, ids.maya, dollars(50))).rejects.toSatisfy(
      isAppError('POLICY_BLOCKED'),
    );
    const approved = await service.approve(planId, ids.maya, dollars(60));
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedAt).not.toBeNull();

    const dealRows = await db.deal.findMany({ where: { planId }, include: { invoice: true } });
    expect(dealRows.map((d) => `${d.invoice.number}:${d.action}:${d.state}`).sort()).toEqual([
      '1038:REMINDER:APPROVED',
      '1041:NEGOTIATE:APPROVED',
      '1043:NEGOTIATE:APPROVED',
    ]);
    expect(approved.items.filter((i) => i.dealState === 'APPROVED')).toHaveLength(3);
    expect(approved.summary.committed).toBe('0.00'); // approval commits nothing
    expect((await db.goal.findUniqueOrThrow({ where: { id: goal.id } })).status).toBe('ACTIVE');
    const approval = await db.approval.findFirstOrThrow({ where: { planId, type: 'PLAN' } });
    expect(approval.decision).toBe('APPROVED');

    await expect(service.approve(planId, ids.maya, dollars(60))).rejects.toSatisfy(
      isAppError('CONFLICT'),
    );
    await expect(
      service.editItem(planId, approved.items[0]!.id, ids.maya, { action: 'NONE' }),
    ).rejects.toSatisfy(isAppError('CONFLICT'));
    await expect(service.createPlan(goal.id)).rejects.toSatisfy(isAppError('CONFLICT'));
  });

  it('counts committed and paid cash only from agreed or paid deals', async () => {
    const goal = await createGoal();
    const planId = await service.createPlan(goal.id);
    await service.approve(planId, ids.maya, dollars(60));
    const juniper = await db.deal.findFirstOrThrow({
      where: { planId, invoiceId: ids.invoices['1041'] },
    });
    const oak = await db.deal.findFirstOrThrow({
      where: { planId, invoiceId: ids.invoices['1038'] },
    });
    await deals.transition({
      dealId: juniper.id,
      to: 'SENT',
      actor: 'SUPPLIER_AGENT',
      reason: 'offer',
    });
    await deals.transition({
      dealId: juniper.id,
      to: 'AGREED',
      actor: 'CLIENT_AGENT',
      reason: 'ok',
    });
    await deals.transition({ dealId: oak.id, to: 'SENT', actor: 'SYSTEM', reason: 'reminder' });
    await deals.transition({ dealId: oak.id, to: 'PAID', actor: 'PAYPAL', reason: 'paid' });
    let view = await service.getView(planId, ids.maya);
    expect(view.summary).toMatchObject({ committed: '4960.00', costSoFar: '40.00', paid: '0.00' });
    await deals.transition({ dealId: juniper.id, to: 'PAID', actor: 'PAYPAL', reason: 'paid' });
    view = await service.getView(planId, ids.maya);
    expect(view.summary).toMatchObject({
      committed: '4960.00',
      paid: '4960.00',
      remaining: '1550.00',
    });
  });
});
