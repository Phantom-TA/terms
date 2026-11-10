import {
  CurrentGoalResponse,
  DealDetail,
  ServerEvent,
  InvoiceRow,
  Plan,
  RunwayResponse,
  UpdatePlanItemResponse,
} from '@terms/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld, PolicyBlockedError, ShapeError } from './world';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

let world: MockWorld;
beforeEach(() => {
  world = new MockWorld();
});

describe('mock world reproduces the CONTEXT.md scenario', () => {
  it('parses the demo sentence', () => {
    const goal = world.parseGoal(SENTENCE);
    expect(goal).toMatchObject({
      amount: '6200.00',
      deadline: '2026-11-13',
      maxDiscountPct: '1.20',
      openingDiscountPct: '0.80',
      bufferPct: '5.00',
      target: '6510.00',
      status: 'DRAFT',
    });
    expect(goal.doNotContact.map((d) => d.matchedName)).toEqual([
      'Pinecrest Dental',
      'Birch Legal',
    ]);
    expect(goal.forecast?.verdict).toBe('CONFIRMED');
  });

  it('plans Juniper in full, Harbor $1,750 and a reminder for Oak, for $54', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const byClient = Object.fromEntries(
      plan.items.filter((i) => i.rank === 'PRIMARY').map((i) => [i.client.name, i]),
    );
    expect(byClient['Juniper Labs']).toMatchObject({
      action: 'NEGOTIATE',
      amountEarly: '5000.00',
      discountPct: '0.80',
      cost: '40.00',
      committedIfAgreed: '4960.00',
      impliedAnnualRate: '16.4',
    });
    expect(byClient['Harbor & Co']).toMatchObject({
      amountEarly: '1750.00',
      cost: '14.00',
      impliedAnnualRate: '12.3',
    });
    expect(byClient['Oak Street Bakery']).toMatchObject({
      action: 'REMINDER',
      countsTowardGoal: false,
    });
    expect(byClient['Pinecrest Dental']?.action).toBe('NONE');
    expect(byClient['Birch Legal']?.action).toBe('NONE');
    expect(plan.summary).toMatchObject({
      target: '6510.00',
      plannedCommitted: '6696.00',
      plannedCost: '54.00',
      committed: '0.00',
      bestEffort: '1800.00',
      goalMet: false,
      shortfall: false,
    });
  });

  it('stores the checks the planner ran on each row', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const byClient = Object.fromEntries(
      plan.items.filter((i) => i.rank === 'PRIMARY').map((i) => [i.client.name, i]),
    );
    expect(byClient['Pinecrest Dental']?.policyChecks).toEqual([
      expect.objectContaining({ rule: 'doNotContact', result: 'blocked' }),
    ]);
    expect(byClient['Oak Street Bakery']?.policyChecks).toEqual([
      expect.objectContaining({ rule: 'doNotContact', result: 'pass' }),
    ]);
    const juniper = byClient['Juniper Labs']?.policyChecks ?? [];
    expect(juniper.length).toBeGreaterThan(3);
    expect(juniper.every((c) => c.result === 'pass')).toBe(true);
  });

  it('records the new checks on an edited row', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const harbor = plan.items.find((i) => i.client.name === 'Harbor & Co')!;
    const edited = world.updateItem(harbor.id, { discountPct: '1.20' }).plan;
    expect(edited.items.find((i) => i.id === harbor.id)?.policyChecks).toContainEqual(
      expect.objectContaining({ rule: 'costCeiling', result: 'needs_approval' }),
    );
  });

  it('creates no deals until the owner approves, as the API does', () => {
    world.parseGoal(SENTENCE);
    world.createPlan();
    expect(world.deals.size).toBe(0);
    expect(world.invoiceRows().every((row) => row.deal === null)).toBe(true);
    world.approve('60.00');
    expect([...world.deals.values()].map((d) => d.state)).toEqual([
      'APPROVED',
      'APPROVED',
      'APPROVED',
    ]);
  });

  it('keeps backups out of the plan totals and out of the deals', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const backups = plan.items.filter((i) => i.rank === 'BACKUP');
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ backupOrder: 1, amountEarly: '2500.00' });
    expect(plan.summary.plannedCost).toBe('54.00');
    world.approve('60.00');
    expect(world.deals.has('item_inv_harbor_backup_1')).toBe(false);
  });

  it('refuses an action that does not fit the amount, as the API does', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const harbor = plan.items.find((i) => i.client.name === 'Harbor & Co')!;
    expect(() => world.updateItem(harbor.id, { action: 'EARLY_DISCOUNT' })).toThrow(ShapeError);
    const juniper = plan.items.find((i) => i.client.name === 'Juniper Labs')!;
    expect(() => world.updateItem(juniper.id, { action: 'PARTIAL_PAYMENT' })).toThrow(ShapeError);
  });

  it('never counts a reminder or an unagreed deal as committed cash', () => {
    world.parseGoal(SENTENCE);
    world.createPlan();
    world.approve('60.00');
    expect(world.plan?.summary.committed).toBe('0.00');
    expect(world.runway().committed).toBe('0.00');
  });

  it('blocks Harbor at 1.5% and says which rule blocked it', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const harbor = plan.items.find((i) => i.client.name === 'Harbor & Co')!;
    try {
      world.updateItem(harbor.id, { discountPct: '1.50' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyBlockedError);
      expect((error as PolicyBlockedError).checks).toContainEqual(
        expect.objectContaining({ rule: 'maxDiscount', result: 'blocked' }),
      );
    }
  });

  it('allows 1.2% for Harbor and then needs the owner above the $60 ceiling', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const harbor = plan.items.find((i) => i.client.name === 'Harbor & Co')!;
    const { plan: edited, policyChecks } = world.updateItem(harbor.id, { discountPct: '1.20' });
    expect(edited.summary.plannedCost).toBe('61.00');
    expect(policyChecks).toContainEqual(
      expect.objectContaining({ rule: 'costCeiling', result: 'needs_approval' }),
    );
  });

  it('refuses a discount on an overdue invoice', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const oak = plan.items.find((i) => i.client.name === 'Oak Street Bakery')!;
    expect(() =>
      world.updateItem(oak.id, { action: 'EARLY_DISCOUNT', discountPct: '0.80' }),
    ).toThrow(PolicyBlockedError);
  });

  it('refuses to message a do-not-contact client', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const pinecrest = plan.items.find((i) => i.client.name === 'Pinecrest Dental')!;
    expect(() => world.updateItem(pinecrest.id, { action: 'REMINDER' })).toThrow(
      PolicyBlockedError,
    );
  });

  it('does not allow editing an approved plan', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    world.approve('60.00');
    expect(() => world.updateItem(plan.items[0]!.id, { discountPct: '0.50' })).toThrow(
      'Only a draft plan',
    );
  });
});

describe('the demo negotiation', () => {
  function started() {
    world.parseGoal(SENTENCE);
    world.createPlan();
    world.approve('60.00');
    return world.startNegotiation();
  }

  it('runs to the owner’s decision and no further', () => {
    const events = started();
    const deals = Object.fromEntries([...world.deals.values()].map((d) => [d.client.name, d]));
    expect(deals['Juniper Labs']).toMatchObject({
      state: 'AWAITING_PAYMENT',
      countsAsCommitted: true,
    });
    expect(deals['Harbor & Co']).toMatchObject({
      state: 'NEEDS_OWNER',
      pendingApprovalId: 'appr_harbor_counter',
    });
    expect(world.plan?.summary.committed).toBe('4960.00');
    for (const event of events) expect(() => ServerEvent.parse(event)).not.toThrow();
  });

  it('asks the owner about a counter $1 over the $60 ceiling', () => {
    started();
    const approval = world.listApprovals().find((a) => a.id === 'appr_harbor_counter');
    expect(approval?.costImpact).toEqual({
      planCostBefore: '54.00',
      planCostAfter: '61.00',
      delta: '7.00',
      ceiling: '60.00',
      overCeilingBy: '1.00',
    });
  });

  it('leaves out a row the owner removed from the plan', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    const harbor = plan.items.find((i) => i.client.name === 'Harbor & Co')!;
    world.updateItem(harbor.id, { action: 'NONE' });
    world.approve('60.00');
    expect(() => world.startNegotiation()).not.toThrow();
    expect(world.dealDetail('deal_harbor')).toBeNull();
    expect(world.dealDetail('deal_juniper')?.state).toBe('AWAITING_PAYMENT');
  });

  it('prices the deal on the terms currently on the table', () => {
    started();
    expect(world.dealDetail('deal_harbor')).toMatchObject({
      cost: '26.25',
      committedIfAgreed: '1723.75',
    });
  });

  it('never reports a payment, which only PayPal can do', () => {
    const first = started();
    const { events } = world.decideApproval('appr_harbor_counter', 'APPROVED', null);
    const states = [...first, ...events].flatMap((e) =>
      e.type === 'deal.updated' ? [e.data.deal.state] : [],
    );
    expect(states).not.toContain('PAID');
    expect(states).not.toContain('PARTIALLY_PAID');
  });

  it('reaches the CONTEXT.md outcome when the owner approves', () => {
    started();
    const { events } = world.decideApproval('appr_harbor_counter', 'APPROVED', null);
    expect(world.plan?.summary).toMatchObject({
      committed: '6689.00',
      costSoFar: '61.00',
      goalMet: true,
    });
    const harbor = world.dealDetail('deal_harbor')!;
    expect(harbor.messages.map((m) => m.type)).toEqual(['OFFER', 'COUNTER', 'COUNTER', 'ACCEPT']);
    expect(harbor.messages[3]).toMatchObject({ impliedAnnualRate: '18.5', payNow: '1729.00' });
    expect(events.some((e) => e.type === 'goal.met')).toBe(true);
    for (const event of events) expect(() => ServerEvent.parse(event)).not.toThrow();
    expect(() => DealDetail.parse(harbor)).not.toThrow();
  });

  it('closes the deal when the owner rejects', () => {
    started();
    world.decideApproval('appr_harbor_counter', 'REJECTED', null);
    expect(world.dealDetail('deal_harbor')).toMatchObject({
      state: 'DECLINED',
      pendingApprovalId: null,
      closedReason: 'You rejected the counter.',
    });
    expect(world.plan?.summary.committed).toBe('4960.00');
  });

  it('refuses a second decision', () => {
    started();
    world.decideApproval('appr_harbor_counter', 'REJECTED', null);
    expect(() => world.decideApproval('appr_harbor_counter', 'APPROVED', null)).toThrow('already');
  });

  it('records which PayPal call each settlement step made', () => {
    started();
    expect(
      world.auditFor('deal_juniper').flatMap((e) => (e.paypalCall ? [e.paypalCall] : [])),
    ).toEqual(['PUT /v2/invoicing/invoices/{id}']);
  });
});

describe('mock world output matches the shared schemas', () => {
  it('validates every response shape', () => {
    world.parseGoal(SENTENCE);
    const plan = world.createPlan();
    expect(() => CurrentGoalResponse.parse(world.currentGoal())).not.toThrow();
    expect(() => Plan.parse(plan)).not.toThrow();
    const rows = world.invoiceRows();
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(() => InvoiceRow.parse(row)).not.toThrow();
    expect(() => RunwayResponse.parse(world.runway())).not.toThrow();
    const harbor = plan.items.find((i) => i.client.name === 'Harbor & Co')!;
    const result = world.updateItem(harbor.id, { discountPct: '1.00' });
    expect(() => UpdatePlanItemResponse.parse(result)).not.toThrow();
  });

  it('draws the runway dipping below zero on payroll day, before the plan', () => {
    world.parseGoal(SENTENCE);
    world.createPlan();
    const runway = world.runway();
    const friday = runway.points.find((p) => p.date === '2026-11-13')!;
    expect(friday.before).toBe('-6200.00');
    expect(friday.afterPlanned).toBe('496.00');
    expect(friday.afterCommitted).toBe('-6200.00');
    expect(runway.thresholds[0]).toMatchObject({ label: 'Payroll', amount: '11400.00' });
  });
});
