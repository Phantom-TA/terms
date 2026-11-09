import fc from 'fast-check';
import { addDays, type Cents, dollars, fromCents } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  cheapestCover,
  compareScores,
  isGoalMet,
  offerOptions,
  type OfferOption,
  type PlannerInput,
  type PlannerInvoice,
  searchUnit,
  targetFor,
} from '../src/planner/planner.js';

const TODAY = '2026-11-09'; // Monday
const FRIDAY = '2026-11-13';

/** The demo scenario from CONTEXT.md. */
function scenario(): PlannerInput {
  const inv = (
    id: string,
    clientId: string,
    amount: number,
    dueInDays: number,
    hasAgent: boolean,
  ): PlannerInvoice => ({
    id,
    number: id,
    clientId,
    clientName: clientId,
    clientHasAgent: hasAgent,
    amountDue: dollars(amount),
    dueDate: addDays(TODAY, dueInDays),
  });
  return {
    today: TODAY,
    deadline: FRIDAY,
    gap: dollars(6200),
    bufferBps: 500,
    maxDiscountBps: 120,
    openingDiscountBps: 80,
    doNotContact: ['pinecrest', 'birch'],
    invoices: [
      inv('1041', 'juniper', 5000, 18, true),
      inv('1043', 'harbor', 7500, 24, true),
      inv('1038', 'oak', 1800, -6, false),
      inv('1039', 'pinecrest', 2000, 9, false),
      inv('1042', 'birch', 1200, 15, false),
    ],
  };
}

describe('buildPlan: the demo scenario', () => {
  const plan = buildPlan(scenario());
  const row = (id: string) => plan.rows.find((r) => r.invoiceId === id && r.rank === 'PRIMARY')!;

  it('targets $6,510 (gap $6,200 + 5%)', () => {
    expect(fromCents(plan.target)).toBe('6510.00');
    expect(fromCents(plan.buffer)).toBe('310.00');
    expect(plan.shortfall).toBe(false);
  });

  it('asks Juniper for the full $5,000 at 0.8% (16.4% a year)', () => {
    expect(row('1041')).toMatchObject({
      action: 'NEGOTIATE',
      discountBps: 80,
      amountEarly: dollars(5000),
      cost: dollars(40),
      committedIfAgreed: dollars(4960),
      payBy: TODAY,
      daysEarly: 18,
      impliedAnnualRate: '16.4',
      reasonCode: 'CHEAPEST_COVER',
    });
  });

  it('asks Harbor for a partial $1,750 at 0.8% (12.3% a year)', () => {
    expect(row('1043')).toMatchObject({
      action: 'NEGOTIATE',
      amountEarly: dollars(1750),
      cost: dollars(14),
      committedIfAgreed: dollars(1736),
      impliedAnnualRate: '12.3',
      reasonCode: 'PARTIAL_TO_FIT_GAP',
    });
  });

  it('pulls $6,750 forward for $54, committing $6,696', () => {
    expect(fromCents(plan.plannedCost)).toBe('54.00');
    expect(fromCents(plan.plannedCommitted)).toBe('6696.00');
    expect(isGoalMet(plan.plannedCommitted, plan.target)).toBe(true);
  });

  it('sends Oak Street a free reminder that is not counted', () => {
    expect(row('1038')).toMatchObject({
      action: 'REMINDER',
      countsTowardGoal: false,
      cost: 0n,
      committedIfAgreed: 0n,
      reasonCode: 'REMINDER_OVERDUE',
      reason: '6 days overdue: a free reminder. Best effort, not counted.',
    });
    expect(fromCents(plan.bestEffort)).toBe('1800.00');
  });

  it('never contacts Pinecrest or Birch', () => {
    for (const id of ['1039', '1042']) {
      expect(row(id)).toMatchObject({ action: 'NONE', reasonCode: 'DO_NOT_CONTACT' });
    }
    expect(plan.rows.filter((r) => ['pinecrest', 'birch'].includes(r.clientId)).length).toBe(2);
  });

  it('has no backups (every eligible invoice is already used)', () => {
    expect(plan.rows.filter((r) => r.rank === 'BACKUP')).toEqual([]);
    expect(plan.rows).toHaveLength(5);
  });

  it('prefers Juniper + Harbor $1,750 over Harbor $6,750 alone (same cost, fewer dollar-days)', () => {
    const harborOnly = buildPlan({
      ...scenario(),
      doNotContact: ['pinecrest', 'birch', 'juniper'],
    });
    const h = harborOnly.rows.find((r) => r.invoiceId === '1043')!;
    expect(h.amountEarly).toBe(dollars(6750));
    expect(harborOnly.plannedCost).toBe(plan.plannedCost); // both $54
  });
});

describe('buildPlan: other cases', () => {
  it('reports a shortfall and asks for everything when the target is unreachable', () => {
    const plan = buildPlan({ ...scenario(), gap: dollars(20000) });
    expect(plan.shortfall).toBe(true);
    const offers = plan.rows.filter((r) => r.countsTowardGoal);
    expect(offers.map((r) => r.amountEarly)).toEqual([dollars(5000), dollars(7500)]);
    expect(offers[0]!.reason).toContain('falls short');
  });

  it('ranks unused eligible invoices as backups by cost', () => {
    const base = scenario();
    const plan = buildPlan({ ...base, gap: dollars(1000), doNotContact: [] });
    const backups = plan.rows.filter((r) => r.rank === 'BACKUP');
    expect(backups.map((b) => b.backupOrder)).toEqual(backups.map((_, i) => i + 1));
    for (let i = 1; i < backups.length; i++) {
      expect(backups[i]!.cost >= backups[i - 1]!.cost).toBe(true);
    }
    expect(backups.every((b) => b.reasonCode === 'BACKUP')).toBe(true);
  });

  it('labels offers to human clients as early discount or partial payment', () => {
    const base = scenario();
    const plan = buildPlan({
      ...base,
      invoices: base.invoices.map((i) => ({ ...i, clientHasAgent: false })),
    });
    const actions = plan.rows.filter((r) => r.countsTowardGoal).map((r) => r.action);
    expect(actions).toEqual(['EARLY_DISCOUNT', 'PARTIAL_PAYMENT']);
  });

  it('reminds invoices due by the deadline that are not needed, and skips paid ones', () => {
    const base = scenario();
    const plan = buildPlan({
      ...base,
      gap: dollars(100),
      invoices: [
        // Due today: too late for a discount, but due by Friday, so it gets a reminder.
        { ...base.invoices[0]!, dueDate: TODAY },
        { ...base.invoices[1]!, amountDue: 0n },
        base.invoices[0]!,
      ],
    });
    expect(plan.rows[1]).toMatchObject({ action: 'NONE', reasonCode: 'ALREADY_PAID' });
    const reasons = plan.rows.map((r) => r.reasonCode);
    expect(reasons).toContain('REMINDER_DUE_BEFORE_DEADLINE');
  });

  it('caps the opening discount at the maximum', () => {
    const plan = buildPlan({ ...scenario(), openingDiscountBps: 300 });
    expect(plan.rows.every((r) => r.discountBps === null || r.discountBps <= 120)).toBe(true);
  });

  it('marks invoices not needed', () => {
    const base = scenario();
    const plan = buildPlan({
      ...base,
      gap: dollars(10),
      invoices: [base.invoices[0]!, { ...base.invoices[1]!, id: 'x', clientId: 'x' }],
    });
    expect(plan.rows.find((r) => r.rank === 'PRIMARY' && r.action === 'NONE')?.reasonCode).toBe(
      'NOT_NEEDED',
    );
  });
});

describe('search helpers', () => {
  it('targetFor and searchUnit', () => {
    expect(targetFor(dollars(6200), 500)).toEqual({ target: dollars(6510), buffer: dollars(310) });
    expect(searchUnit(dollars(6510))).toBe(dollars(1));
    expect(searchUnit(dollars(5_000_000))).toBe(dollars(100));
  });

  it('a zero target needs nothing; overdue invoices have no options', () => {
    expect(cheapestCover([], 0n)).toEqual([]);
    expect(offerOptions({ ...scenario().invoices[2]! }, 0, 80, TODAY, dollars(250))).toEqual([]);
  });

  it('compareScores is lexicographic', () => {
    const s = { cost: 1n, partials: 1, dollarDays: 1n, clients: 1 };
    expect(compareScores(s, { ...s, cost: 2n })).toBeLessThan(0);
    expect(compareScores(s, { ...s, partials: 0 })).toBeGreaterThan(0);
    expect(compareScores(s, { ...s, dollarDays: 2n })).toBeLessThan(0);
    expect(compareScores(s, { ...s, clients: 0 })).toBeGreaterThan(0);
    expect(compareScores(s, s)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

const arbInvoice = (i: number) =>
  fc.record({
    amount: fc.integer({ min: 1, max: 40 }).map((n) => dollars(n * 100)),
    dueIn: fc.integer({ min: -10, max: 40 }),
    hasAgent: fc.boolean(),
    client: fc.constantFrom('a', 'b', 'c', 'd', `c${i}`),
  });

const arbInput = fc
  .tuple(
    fc.array(arbInvoice(0), { minLength: 1, maxLength: 5 }),
    fc.integer({ min: 1, max: 80 }).map((n) => dollars(n * 100)),
    fc.integer({ min: 10, max: 300 }),
    fc.subarray(['a', 'b', 'c', 'd']),
  )
  .map(([invs, gap, maxBps, dnc]): PlannerInput => ({
    today: TODAY,
    deadline: FRIDAY,
    gap,
    bufferBps: 500,
    maxDiscountBps: maxBps,
    openingDiscountBps: Math.floor((maxBps * 2) / 30) * 10,
    doNotContact: dnc,
    invoices: invs.map((v, i) => ({
      id: `inv${i}`,
      number: `${i}`,
      clientId: v.client,
      clientName: v.client,
      clientHasAgent: v.hasAgent,
      amountDue: v.amount,
      dueDate: addDays(TODAY, v.dueIn),
    })),
  }));

interface Score {
  cost: bigint;
  partials: number;
  dollarDays: bigint;
  clients: number;
}

/**
 * Exhaustive search over every combination (small inputs only), on the same grid as the planner:
 * each offer's committed cash is rounded down to whole dollars before it counts toward the target.
 */
function bruteForce(groups: OfferOption[][], target: Cents): Score | null {
  const unit = searchUnit(target);
  const units = (target + unit - 1n) / unit;
  const state: { best: Score | null } = { best: null };
  const walk = (g: number, acc: Score & { committed: bigint }) => {
    if (g === groups.length) {
      if (acc.committed >= units && (state.best === null || compareScores(acc, state.best) < 0)) {
        state.best = {
          cost: acc.cost,
          partials: acc.partials,
          dollarDays: acc.dollarDays,
          clients: acc.clients,
        };
      }
      return;
    }
    walk(g + 1, acc);
    for (const o of groups[g]!) {
      walk(g + 1, {
        cost: acc.cost + o.cost,
        partials: acc.partials + (o.partial ? 1 : 0),
        dollarDays: acc.dollarDays + o.dollarDays,
        clients: acc.clients + 1,
        committed: acc.committed + o.committed / unit,
      });
    }
  };
  walk(0, { cost: 0n, partials: 0, dollarDays: 0n, clients: 0, committed: 0n });
  return state.best;
}

describe('planner properties', () => {
  it('never offers above the maximum, never contacts a protected client, never discounts an overdue invoice', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = buildPlan(input);
        for (const r of plan.rows) {
          if (r.discountBps !== null)
            expect(r.discountBps).toBeLessThanOrEqual(input.maxDiscountBps);
          if (input.doNotContact.includes(r.clientId)) expect(r.action).toBe('NONE');
          const inv = input.invoices.find((i) => i.id === r.invoiceId)!;
          if (inv.dueDate <= TODAY) expect(r.discountBps).toBeNull();
          if (r.amountEarly !== null) expect(r.amountEarly <= inv.amountDue).toBe(true);
        }
        expect(plan.rows.filter((r) => r.rank === 'PRIMARY')).toHaveLength(input.invoices.length);
      }),
      { numRuns: 300 },
    );
  });

  it('when feasible, covers the target in exact cents and only reminders are best effort', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = buildPlan(input);
        if (!plan.shortfall) expect(plan.plannedCommitted >= plan.target).toBe(true);
        for (const r of plan.rows) {
          if (r.action === 'REMINDER' || r.action === 'NONE') {
            expect(r.countsTowardGoal).toBe(false);
            expect(r.committedIfAgreed).toBe(0n);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('matches brute force on cost (exact optimum on the $1 grid, never over-claiming)', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const opening = Math.min(input.openingDiscountBps, input.maxDiscountBps);
        const groups = input.invoices
          .map((inv, i) =>
            input.doNotContact.includes(inv.clientId)
              ? []
              : offerOptions(inv, i, opening, TODAY, dollars(250)),
          )
          .filter((g) => g.length > 0);
        const { target } = targetFor(input.gap, input.bufferBps);
        const dp = cheapestCover(groups, target);
        const bf = bruteForce(groups, target);
        if (bf === null) {
          expect(dp).toBeNull();
          return;
        }
        expect(dp).not.toBeNull();
        const dpCost = dp!.reduce((s, o) => s + o.cost, 0n);
        expect(dpCost).toBe(bf.cost);
        // The chosen offers truly cover the target in exact cents.
        expect(dp!.reduce((s, o) => s + o.committed, 0n) >= target).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
