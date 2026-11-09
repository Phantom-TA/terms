import {
  CurrentGoalResponse,
  InvoiceRow,
  Plan,
  RunwayResponse,
  UpdatePlanItemResponse,
} from '@terms/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld, PolicyBlockedError } from './world';

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
    const byClient = Object.fromEntries(plan.items.map((i) => [i.client.name, i]));
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
