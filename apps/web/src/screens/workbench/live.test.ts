import {
  type CurrentGoalResponse,
  type ListInvoicesResponse,
  type ServerEventOf,
} from '@terms/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld } from '../../mocks/world';
import {
  applyDealUpdated,
  applyInvoiceUpdated,
  applyPlanUpdated,
  applyRunwayUpdated,
} from './live';

const AT = '2026-11-09T10:30:00Z';

let world: MockWorld;
let invoices: ListInvoicesResponse;
let goal: CurrentGoalResponse;

beforeEach(() => {
  world = new MockWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  invoices = {
    rows: world.invoiceRows(),
    planId: 'plan_1',
    today: '2026-11-09',
    lastSyncedAt: AT,
    demo: true,
  };
  goal = world.currentGoal();
});

describe('applyInvoiceUpdated', () => {
  it('replaces only the changed invoice', () => {
    const juniper = invoices.rows.find((r) => r.id === 'inv_juniper')!;
    const event: ServerEventOf<'invoice.updated'> = {
      id: 'e1',
      type: 'invoice.updated',
      at: AT,
      data: {
        invoice: { ...juniper, paypalStatus: 'PAID', amountPaid: '4960.00', amountDue: '0.00' },
      },
    };
    const next = applyInvoiceUpdated(invoices, event)!;
    expect(next.rows.find((r) => r.id === 'inv_juniper')?.paypalStatus).toBe('PAID');
    expect(next.rows.filter((r) => r.id !== 'inv_juniper')).toEqual(
      invoices.rows.filter((r) => r.id !== 'inv_juniper'),
    );
    expect(next.rows).toHaveLength(invoices.rows.length);
  });

  it('adds an invoice it has not seen', () => {
    const juniper = invoices.rows.find((r) => r.id === 'inv_juniper')!;
    const next = applyInvoiceUpdated(invoices, {
      id: 'e2',
      type: 'invoice.updated',
      at: AT,
      data: { invoice: { ...juniper, id: 'inv_new', number: '1050' } },
    })!;
    expect(next.rows).toHaveLength(invoices.rows.length + 1);
  });

  it('does nothing before the first load', () => {
    const juniper = invoices.rows[0]!;
    expect(
      applyInvoiceUpdated(undefined, {
        id: 'e3',
        type: 'invoice.updated',
        at: AT,
        data: { invoice: juniper },
      }),
    ).toBeUndefined();
  });
});

describe('applyDealUpdated', () => {
  it('shows the server’s new deal state on the row and its plan item', () => {
    const deal = {
      ...world.invoiceRows()[0]!.deal!,
      state: 'AWAITING_PAYMENT' as const,
      countsAsCommitted: true,
    };
    const next = applyDealUpdated(invoices, {
      id: 'e4',
      type: 'deal.updated',
      at: AT,
      data: { deal },
    })!;
    const row = next.rows.find((r) => r.id === 'inv_juniper')!;
    expect(row.deal?.state).toBe('AWAITING_PAYMENT');
    expect(row.deal?.countsAsCommitted).toBe(true);
    expect(row.planItem?.dealState).toBe('AWAITING_PAYMENT');
  });

  it('leaves other invoices untouched', () => {
    const deal = { ...world.invoiceRows()[0]!.deal!, state: 'DECLINED' as const };
    const next = applyDealUpdated(invoices, {
      id: 'e5',
      type: 'deal.updated',
      at: AT,
      data: { deal },
    })!;
    expect(next.rows.find((r) => r.id === 'inv_harbor')).toEqual(
      invoices.rows.find((r) => r.id === 'inv_harbor'),
    );
  });
});

describe('applyPlanUpdated', () => {
  it('takes the server’s status and totals, never its own', () => {
    const summary = { ...goal.plan!.summary, committed: '4960.00', costSoFar: '40.00' };
    const next = applyPlanUpdated(goal, {
      id: 'e6',
      type: 'plan.updated',
      at: AT,
      data: { planId: 'plan_1', status: 'APPROVED', summary },
    })!;
    expect(next.plan?.status).toBe('APPROVED');
    expect(next.plan?.summary.committed).toBe('4960.00');
    expect(next.plan?.items).toBe(goal.plan?.items);
  });

  it('ignores an update for a different plan', () => {
    const next = applyPlanUpdated(goal, {
      id: 'e7',
      type: 'plan.updated',
      at: AT,
      data: { planId: 'plan_other', status: 'MET', summary: goal.plan!.summary },
    });
    expect(next).toBe(goal);
  });

  it('ignores an update when there is no plan yet', () => {
    const empty: CurrentGoalResponse = { goal: goal.goal, plan: null };
    expect(
      applyPlanUpdated(empty, {
        id: 'e8',
        type: 'plan.updated',
        at: AT,
        data: { planId: 'plan_1', status: 'APPROVED', summary: goal.plan!.summary },
      }),
    ).toBe(empty);
  });
});

describe('applyRunwayUpdated', () => {
  it('replaces the runway with the server’s', () => {
    const runway = world.runway();
    expect(
      applyRunwayUpdated(undefined, {
        id: 'e9',
        type: 'runway.updated',
        at: AT,
        data: { runway },
      }),
    ).toBe(runway);
  });
});
