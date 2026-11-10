import { type PlanSummary, type RunwayResponse } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import { buildStudioTools, type StudioData, type StudioPlan } from '../../src/ai/studio-tools.js';
import { type CapSimulation } from '../../src/plans/plan-service.js';

const point = (n: number, before: number) => ({
  date: `2026-11-${String(n).padStart(2, '0')}`,
  before: before.toFixed(2),
  afterCommitted: before.toFixed(2),
  afterPlanned: (before + 100).toFixed(2),
  afterBestEffort: before.toFixed(2),
});

const runway = (days: number): RunwayResponse => ({
  currency: 'USD',
  today: '2026-11-09',
  asOf: '2026-11-09T13:29:59.000Z',
  balance: '5200.00',
  planId: null,
  deadline: '2026-11-13',
  gap: '6200.00',
  committed: '0.00',
  bestEffort: '1800.00',
  thresholds: [{ label: 'Payroll $11,400.00', amount: '11400.00', date: '2026-11-13' }],
  points: Array.from({ length: days }, (_, i) => point(i + 1, 5200 - i * 100)),
  events: Array.from({ length: 30 }, (_, i) => ({
    date: '2026-11-13',
    amount: '-10.00',
    kind: 'PAYROLL' as const,
    label: `Event ${String(i)}`,
    committed: true,
  })),
});

const scenario = {
  label: 'Discounts capped at 1.50%',
  points: [point(1, 5200), point(2, 5100)],
};

const sim: CapSimulation = {
  maxDiscountPct: '1.50',
  target: '6510.00',
  plannedCommitted: '6600.00',
  plannedCost: '70.00',
  shortfall: false,
  offers: Array.from({ length: 30 }, (_, i) => ({
    invoiceNumber: String(1000 + i),
    client: 'Harbor & Co',
    action: 'NEGOTIATE',
    discountPct: '1.50',
    amountEarly: '1000.00',
    payBy: '2026-11-09',
    cost: '15.00',
    committedIfAgreed: '985.00',
  })),
};

function fakeData(over: Partial<StudioData> = {}): StudioData & { asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    openInvoices: (filter) => {
      asked.push(filter);
      return Promise.resolve(
        Array.from({ length: 60 }, (_, i) => ({
          number: String(1000 + i),
          client: 'Harbor & Co',
          amount: '100.00',
          amountDue: '100.00',
          dueDate: '2026-12-01',
          daysUntilDue: 22,
          status: 'SENT',
          contactAllowed: true,
        })),
      );
    },
    runway: (days) => {
      asked.push(days);
      return Promise.resolve(runway(days));
    },
    plan: () =>
      Promise.resolve<StudioPlan>({
        goal: {
          amount: '6200.00',
          deadline: '2026-11-13',
          maxDiscountPct: '1.20',
          bufferPct: '5.00',
          status: 'PLANNED',
        },
        summary: { committed: '1500.00' } as PlanSummary,
        rows: Array.from({ length: 40 }, (_, i) => ({
          invoiceNumber: String(i),
          client: 'Harbor & Co',
          action: 'NEGOTIATE',
          rank: 'PRIMARY',
          discountPct: '0.80',
          amountEarly: '100.00',
          cost: '0.80',
          committedIfAgreed: '99.20',
          dealState: null,
        })),
      }),
    cashHistory: (days) =>
      Promise.resolve({
        days,
        totals: [{ kind: 'PAYROLL', direction: 'OUT', count: 2, total: '22800.00' }],
        recent: Array.from({ length: 40 }, (_, i) => ({
          date: '2026-11-01',
          direction: 'OUT',
          amount: '10.00',
          kind: 'OTHER',
          label: `Txn ${String(i)}`,
        })),
      }),
    simulate: (bps) => {
      asked.push(bps);
      return Promise.resolve({ simulation: sim, scenario });
    },
    ...over,
  };
}

const tool = (name: string, data: StudioData) => {
  const found = buildStudioTools(data).find((t) => t.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

describe('the studio data tools', () => {
  it('offers exactly the five tools the contract names', () => {
    expect(buildStudioTools(fakeData()).map((t) => t.name)).toEqual([
      'get_open_invoices',
      'get_cash_runway',
      'get_plan_summary',
      'get_cash_history',
      'simulate_discount_cap',
    ]);
  });

  it('get_open_invoices applies its defaults and limit, and never returns more than asked', async () => {
    const data = fakeData();
    const result = await tool('get_open_invoices', data).run({});
    expect(data.asked).toEqual([{ limit: 25 }]);
    expect((result.output as { invoices: unknown[] }).invoices).toHaveLength(25);
    expect(result.summary).toBe('25 open invoices, $2,500.00 due');
    await tool('get_open_invoices', data).run({ clientName: 'harbor', limit: 3 });
    expect(data.asked[1]).toEqual({ clientName: 'harbor', limit: 3 });
    await expect(tool('get_open_invoices', data).run({ limit: 500 })).rejects.toThrow();
    await expect(
      tool('get_open_invoices', data).run({ clientName: 'x'.repeat(101) }),
    ).rejects.toThrow();
  });

  it('get_cash_runway gives the balance, the low point and a bounded series', async () => {
    const data = fakeData();
    const result = await tool('get_cash_runway', data).run({});
    expect(data.asked).toEqual([30]);
    const out = result.output as {
      balance: string;
      lowestBeforePlan: { date: string; balance: string };
      points: unknown[];
      events: unknown[];
      obligations: unknown[];
    };
    expect(out.balance).toBe('5200.00');
    expect(out.lowestBeforePlan).toEqual({ date: '2026-11-30', balance: '2300.00' });
    expect(out.points).toHaveLength(16);
    expect(out.events).toHaveLength(15);
    expect(out.obligations).toHaveLength(1);
    expect(result.summary).toBe('balance $5,200.00, lowest $2,300.00 on 2026-11-30');
    await expect(tool('get_cash_runway', data).run({ horizonDays: 3 })).rejects.toThrow();
    // A short series is passed through whole.
    const short = await tool(
      'get_cash_runway',
      fakeData({ runway: () => Promise.resolve(runway(5)) }),
    ).run({});
    expect((short.output as { points: unknown[] }).points).toHaveLength(5);
  });

  it('get_plan_summary says when there is no goal, and bounds its rows', async () => {
    const result = await tool('get_plan_summary', fakeData()).run({});
    expect((result.output as { rows: unknown[] }).rows).toHaveLength(25);
    expect(result.summary).toBe('goal $6,200.00 by 2026-11-13, $1,500.00 committed');
    const none = await tool(
      'get_plan_summary',
      fakeData({ plan: () => Promise.resolve({ goal: null, summary: null, rows: [] }) }),
    ).run({});
    expect(none.summary).toBe('no current goal');
  });

  it('get_cash_history reports totals and the latest movements', async () => {
    const result = await tool('get_cash_history', fakeData()).run({ days: 14 });
    expect(result.summary).toBe('2 movements in the last 14 days');
    expect((result.output as { recent: unknown[] }).recent).toHaveLength(25);
    await expect(tool('get_cash_history', fakeData()).run({ days: 0 })).rejects.toThrow();
  });

  it('simulate_discount_cap converts the percentage, bounds it, and reads nothing it should not', async () => {
    const data = fakeData();
    const result = await tool('simulate_discount_cap', data).run({ maxDiscountPct: '1.5' });
    expect(data.asked).toEqual([150]);
    expect((result.output as { offers: unknown[] }).offers).toHaveLength(25);
    expect(result.summary).toBe('at 1.50%: commits $6,600.00 for $70.00');
    // The what-if runway travels beside the result, for the browser to chart; the model is told it exists.
    expect(result.scenario).toEqual(scenario);
    expect(result.output).toMatchObject({ scenarioTableAvailable: true });
    const noBalance = await tool(
      'simulate_discount_cap',
      fakeData({ simulate: () => Promise.resolve({ simulation: sim, scenario: null }) }),
    ).run({ maxDiscountPct: '1.5' });
    expect(noBalance.scenario).toBeUndefined();
    expect(noBalance.output).toMatchObject({ scenarioTableAvailable: false });
    for (const bad of ['0', '0.00', '25', 'abc', '']) {
      await expect(
        tool('simulate_discount_cap', data).run({ maxDiscountPct: bad }),
        bad,
      ).rejects.toThrow();
    }
    await expect(
      tool('simulate_discount_cap', fakeData({ simulate: () => Promise.resolve(null) })).run({
        maxDiscountPct: '1.5',
      }),
    ).rejects.toThrow('no current goal');
    const short = await tool(
      'simulate_discount_cap',
      fakeData({
        simulate: () =>
          Promise.resolve({ simulation: { ...sim, shortfall: true }, scenario: null }),
      }),
    ).run({ maxDiscountPct: '1.5' });
    expect(short.summary).toContain('(short of the target)');
  });
});
