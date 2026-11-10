import { addDays, dollars, MAX_NEGOTIATION_ROUNDS } from '@terms/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ClientView,
  clientMove,
  daysEarlyOf,
  PARTIAL_STEP,
  type SupplierView,
  supplierMove,
  type Terms,
} from '../../src/negotiation/strategies.js';

const TODAY = '2026-11-09';

const harborView: ClientView = {
  supplierId: 'maya',
  invoiceDue: dollars(7500),
  dueDate: '2026-12-03', // 24 days
  cashAvailable: dollars(60000),
  policy: {
    hurdleBps: 1500,
    targetBps: 2300,
    cashBuffer: dollars(20000),
    autoPayLimit: dollars(2000),
    earlyPayCap: dollars(5000),
    neverPayEarly: [],
  },
};

const juniperView: ClientView = {
  supplierId: 'maya',
  invoiceDue: dollars(5000),
  dueDate: '2026-11-27', // 18 days
  cashAvailable: dollars(80000),
  policy: {
    hurdleBps: 1200,
    targetBps: 2000,
    cashBuffer: dollars(20000),
    autoPayLimit: dollars(3000),
    earlyPayCap: null,
    neverPayEarly: [],
  },
};

/** Maya's view of Harbor's row: Juniper's $40 is the rest of the plan; ceiling $60. */
const mayaOnHarbor: SupplierView = {
  clientId: 'harbor',
  doNotContact: ['pinecrest', 'birch'],
  maxBps: 120,
  planBps: 80,
  ceiling: dollars(60),
  otherRowsCost: dollars(40),
  invoiceDue: dollars(7500),
  dueDate: '2026-12-03',
  today: TODAY,
};

const offer = (amount: number, bps: number, remainderDue: string | null = null): Terms => ({
  amountEarly: dollars(amount),
  discountBps: bps,
  payBy: TODAY,
  remainderDue,
});

describe('the CONTEXT.md demo negotiation, move by move', () => {
  it('Juniper accepts 0.8% (16.4% a year) and needs a person to approve $4,960', () => {
    const move = clientMove(juniperView, offer(5000, 80), 1);
    expect(move).toMatchObject({
      type: 'ACCEPT',
      payment: dollars(4960),
      needsHumanApproval: true,
    });
  });

  it('Harbor counters 0.8% at 1.5%; Maya can only go to 1.2%, $1 over the ceiling; Harbor accepts', () => {
    const first = clientMove(harborView, offer(1750, 80, '2026-12-03'), 1);
    expect(first).toMatchObject({
      type: 'COUNTER',
      terms: { amountEarly: dollars(1750), discountBps: 150, remainderDue: '2026-12-03' },
    });
    if (first.type !== 'COUNTER') throw new Error('expected a counter');
    expect(first.reason).toContain('1.50% reaches our 23.00% target');

    const maya = supplierMove(mayaOnHarbor, first.terms, 2);
    expect(maya).toMatchObject({
      type: 'NEEDS_OWNER',
      onApproval: 'COUNTER',
      overCeilingBy: dollars(1),
      terms: { discountBps: 120, amountEarly: dollars(1750) },
    });
    if (maya.type !== 'NEEDS_OWNER') throw new Error('expected NEEDS_OWNER');
    expect(maya.checks.find((c) => c.rule === 'maxDiscount')?.result).toBe('pass');

    // The owner approves; the counter goes out as round 3 and Harbor accepts at 18.5% a year.
    const last = clientMove(harborView, maya.terms, 3);
    expect(last).toMatchObject({
      type: 'ACCEPT',
      payment: dollars(1729),
      needsHumanApproval: false,
    });
  });
});

describe('client strategy', () => {
  it('declines a supplier it never pays early, past the round limit, or for no early payment', () => {
    const never = { ...harborView, policy: { ...harborView.policy, neverPayEarly: ['maya'] } };
    expect(clientMove(never, offer(1000, 120), 1)).toMatchObject({ type: 'DECLINE' });
    expect(clientMove(harborView, offer(1000, 120), MAX_NEGOTIATION_ROUNDS + 1)).toMatchObject({
      type: 'DECLINE',
      reason: 'Round limit reached',
    });
    expect(clientMove(harborView, { ...offer(1000, 120), payBy: '2026-12-03' }, 1)).toMatchObject({
      type: 'DECLINE',
      reason: 'The offer asks for no early payment',
    });
  });

  it('splits an amount above its cap and steps down to fit the cash buffer', () => {
    const capped = clientMove(harborView, offer(7500, 150), 1);
    expect(capped).toMatchObject({
      type: 'COUNTER',
      terms: { amountEarly: dollars(5000), discountBps: 150, remainderDue: '2026-12-03' },
    });
    const tight = { ...harborView, cashAvailable: dollars(21000) }; // $1,000 spare
    const fit = clientMove(tight, offer(1750, 150), 1);
    expect(fit).toMatchObject({ type: 'COUNTER', terms: { amountEarly: dollars(1000) } });
    const broke = { ...harborView, cashAvailable: dollars(20100) };
    expect(clientMove(broke, offer(1750, 150), 1)).toMatchObject({
      type: 'DECLINE',
      reason: 'No early payment fits the cash buffer',
    });
  });

  it('declines instead of countering in the last round', () => {
    expect(clientMove(harborView, offer(1750, 80), MAX_NEGOTIATION_ROUNDS)).toMatchObject({
      type: 'DECLINE',
    });
  });

  it('never counters below its hurdle, even when the target rounds down', () => {
    // A target barely above the hurdle can round to a discount under the hurdle.
    const close = {
      ...harborView,
      policy: { ...harborView.policy, hurdleBps: 1500, targetBps: 1501 },
    };
    const move = clientMove(close, offer(1000, 50), 1);
    if (move.type !== 'COUNTER') throw new Error('expected a counter');
    expect(move.checks.find((c) => c.rule === 'hurdleRate')?.result).toBe('pass');
  });
});

describe('supplier strategy', () => {
  const lone = { ...mayaOnHarbor, otherRowsCost: 0n };

  it('accepts at or below the plan, and up to the maximum within the ceiling', () => {
    expect(supplierMove(lone, offer(1750, 80), 2)).toMatchObject({
      type: 'ACCEPT',
      terms: { discountBps: 80 },
    });
    expect(supplierMove(lone, offer(1750, 110), 2)).toMatchObject({
      type: 'ACCEPT',
      terms: { discountBps: 110 },
    });
  });

  it('counters an ask above the maximum at the maximum, never above it', () => {
    expect(supplierMove(lone, offer(1750, 300), 2)).toMatchObject({
      type: 'COUNTER',
      terms: { discountBps: 120 },
    });
  });

  it('asks the owner when accepting would cross the ceiling', () => {
    expect(supplierMove(mayaOnHarbor, offer(2000, 110), 2)).toMatchObject({
      type: 'NEEDS_OWNER',
      onApproval: 'ACCEPT',
      overCeilingBy: dollars(2),
    });
  });

  it('declines a do-not-contact client, an amount above the invoice, and a counter past the round limit', () => {
    expect(supplierMove({ ...lone, clientId: 'birch' }, offer(100, 80), 2)).toMatchObject({
      type: 'DECLINE',
    });
    expect(supplierMove(lone, offer(9000, 80), 2)).toMatchObject({ type: 'DECLINE' });
    expect(supplierMove(lone, offer(1750, 300), MAX_NEGOTIATION_ROUNDS)).toMatchObject({
      type: 'DECLINE',
    });
  });
});

describe('strategy properties (fast-check)', () => {
  const clientView = fc.record({
    hurdle: fc.integer({ min: 300, max: 3000 }),
    targetExtra: fc.integer({ min: 0, max: 2000 }),
    buffer: fc.integer({ min: 0, max: 50000 }),
    spare: fc.integer({ min: 0, max: 30000 }),
    cap: fc.option(fc.integer({ min: 250, max: 20000 }), { nil: null }),
    invoice: fc.integer({ min: 250, max: 20000 }),
    days: fc.integer({ min: 1, max: 60 }),
  });

  it('every client counter meets its own hurdle, cap and buffer; every accept meets all rules', () => {
    fc.assert(
      fc.property(
        clientView,
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 1, max: 3 }),
        (v, bps, round) => {
          const due = addDays(TODAY, v.days);
          const view: ClientView = {
            supplierId: 's',
            invoiceDue: dollars(v.invoice),
            dueDate: due,
            cashAvailable: dollars(v.buffer + v.spare),
            policy: {
              hurdleBps: v.hurdle,
              targetBps: v.hurdle + v.targetExtra,
              cashBuffer: dollars(v.buffer),
              autoPayLimit: dollars(3000),
              earlyPayCap: v.cap === null ? null : dollars(v.cap),
              neverPayEarly: [],
            },
          };
          const terms = offer(v.invoice, bps);
          if (daysEarlyOf(terms, due) < 1) return;
          const move = clientMove(view, { ...terms }, round);
          if (move.type === 'DECLINE') return;
          const blocked = move.checks.filter((c) => c.result === 'blocked');
          expect(blocked).toEqual([]);
          if (move.type === 'COUNTER') {
            expect(
              move.terms.amountEarly % PARTIAL_STEP === 0n ||
                move.terms.amountEarly === dollars(v.invoice),
            ).toBe(true);
            expect(move.terms.discountBps).toBeGreaterThanOrEqual(bps);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('the supplier never accepts or counters above its maximum, and never crosses the ceiling unasked', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 300 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 250, max: 20000 }),
        fc.integer({ min: 2, max: 3 }),
        (max, ask, ceiling, amount, round) => {
          const view: SupplierView = {
            ...lone(),
            maxBps: max,
            planBps: Math.min(max, 80),
            ceiling: dollars(ceiling),
            invoiceDue: dollars(20000),
          };
          const move = supplierMove(view, offer(amount, ask), round);
          if (move.type === 'DECLINE') return;
          expect(move.terms.discountBps).toBeLessThanOrEqual(max);
          const cost = (move.terms.amountEarly * BigInt(move.terms.discountBps) + 5000n) / 10000n;
          if (move.type !== 'NEEDS_OWNER') expect(cost).toBeLessThanOrEqual(dollars(ceiling));
        },
      ),
      { numRuns: 400 },
    );
  });

  function lone(): SupplierView {
    return { ...mayaOnHarbor, otherRowsCost: 0n };
  }
});
