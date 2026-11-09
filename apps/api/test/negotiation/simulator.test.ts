import { paymentFor } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import {
  type Movers,
  randomScenario,
  rng,
  runNegotiation,
  simulate,
  violationsOf,
} from '../../src/negotiation/simulator.js';

const seeds = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

describe('negotiation simulator (deterministic strategies)', () => {
  it('50 seeded runs with random policies: 0 policy violations (the CONTEXT.md pass bar)', () => {
    const report = simulate(seeds(50));
    expect(report.violations).toEqual([]);
    expect(report.runs).toBe(50);
    // The runs exercise every path, not just easy agreements.
    expect(report.agreed).toBeGreaterThan(0);
    expect(report.declined).toBeGreaterThan(0);
    expect(report.ownerAsked).toBeGreaterThan(0);
    expect(report.humanApprovals).toBeGreaterThan(0);
  });

  it('stays at 0 violations over 1,000 more seeds', () => {
    expect(simulate(seeds(1000, 1001)).violations).toEqual([]);
  });

  it('is reproducible from its seed', () => {
    expect(runNegotiation(randomScenario(42))).toEqual(runNegotiation(randomScenario(42)));
    const a = rng(7);
    const b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('the independent violation checker catches broken agents', () => {
  /** A client that accepts anything and a supplier that agrees to whatever it is asked. */
  const reckless: Movers = {
    client: (view, offer) => ({
      type: 'ACCEPT',
      terms: offer,
      payment: paymentFor(offer.amountEarly, offer.discountBps),
      needsHumanApproval: false,
      checks: [],
    }),
    supplier: (_view, counter) => ({ type: 'ACCEPT', terms: counter, checks: [] }),
  };

  /** A client that always asks for 5%, and a supplier that grants any ask. */
  const greedy: Movers = {
    client: (view, offer, round) =>
      round === 1
        ? { type: 'COUNTER', terms: { ...offer, discountBps: 500 }, reason: 'more', checks: [] }
        : {
            type: 'ACCEPT',
            terms: offer,
            payment: paymentFor(offer.amountEarly, offer.discountBps),
            needsHumanApproval: false,
            checks: [],
          },
    supplier: (_view, counter) => ({ type: 'ACCEPT', terms: counter, checks: [] }),
  };

  it('flags clients that accept below their own policy', () => {
    const rules = new Set(simulate(seeds(200), reckless).violations.map((v) => v.rule));
    expect(rules).toContain('hurdleRate');
    expect(rules).toContain('autoPayLimit');
    expect(rules).toContain('cashBuffer');
  });

  it('flags suppliers that go above the maximum or the ceiling', () => {
    const rules = new Set(simulate(seeds(200), greedy).violations.map((v) => v.rule));
    expect(rules).toContain('maxDiscount');
    expect(rules).toContain('costCeiling');
  });

  it('flags agreements past the round limit and with the wrong split flag', () => {
    const s = randomScenario(3);
    const run = runNegotiation(s);
    const tampered = {
      ...run,
      outcome: 'AGREED' as const,
      agreed: { ...s.opening, remainderDue: s.opening.remainderDue === null ? '2027-01-01' : null },
      messages: [
        ...run.messages,
        { side: 'CLIENT' as const, type: 'ACCEPT' as const, round: 4, terms: null },
      ],
    };
    const rules = violationsOf(s, tampered).map((v) => v.rule);
    expect(rules).toContain('roundLimit');
    expect(rules).toContain('remainderDue');
  });
});
