import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dollars } from '../src/money.js';
import {
  allPass,
  blockedRules,
  checkAmountWithinInvoice,
  checkAutoPayLimit,
  checkCashBuffer,
  checkCostCeiling,
  checkDoNotContact,
  checkEarlyPayCap,
  checkHurdleRate,
  checkMaxDiscount,
  checkNeverPayEarly,
  checkOfferExpiry,
  checkOverdueNoDiscount,
  checkPayByBeforeDue,
  checkRoundLimit,
  evaluateClientOffer,
  evaluateReminder,
  evaluateSupplierTerms,
  isBlocked,
  needsApproval,
  paymentFor,
} from '../src/policy.js';

const TODAY = '2026-11-09';

describe('supplier checks', () => {
  it('max discount is a hard block above the maximum', () => {
    expect(checkMaxDiscount(120, 120).result).toBe('pass');
    const blocked = checkMaxDiscount(150, 120);
    expect(blocked).toEqual({
      rule: 'maxDiscount',
      result: 'blocked',
      detail: '1.50% is above the 1.20% maximum',
    });
  });

  it('max discount passes exactly when bps ≤ max (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (d, m) => {
          expect(checkMaxDiscount(d, m).result === 'pass').toBe(d <= m);
        },
      ),
    );
  });

  it('do-not-contact blocks listed clients', () => {
    expect(checkDoNotContact('pinecrest', ['pinecrest', 'birch']).result).toBe('blocked');
    expect(checkDoNotContact('harbor', ['pinecrest', 'birch']).result).toBe('pass');
    expect(evaluateReminder({ doNotContact: ['birch'] }, 'birch')[0]!.result).toBe('blocked');
  });

  it('cost above the ceiling needs the owner (the $61 vs $60 case)', () => {
    expect(checkCostCeiling(dollars(60), dollars(60)).result).toBe('pass');
    const over = checkCostCeiling(dollars(61), dollars(60));
    expect(over.result).toBe('needs_approval');
    expect(over.detail).toBe('Plan cost $61.00 is $1.00 over the $60.00 ceiling');
  });

  it('overdue invoices never get a discount', () => {
    expect(checkOverdueNoDiscount(80, '2026-11-03', TODAY).result).toBe('blocked');
    expect(checkOverdueNoDiscount(0, '2026-11-03', TODAY).result).toBe('pass');
    expect(checkOverdueNoDiscount(80, '2026-11-27', TODAY).result).toBe('pass');
    expect(checkOverdueNoDiscount(80, TODAY, TODAY).result).toBe('pass');
  });

  it('early amount must be within what is due', () => {
    expect(checkAmountWithinInvoice(0n, dollars(100)).result).toBe('blocked');
    expect(checkAmountWithinInvoice(dollars(101), dollars(100)).result).toBe('blocked');
    expect(checkAmountWithinInvoice(dollars(100), dollars(100)).result).toBe('pass');
  });

  it('pay-by must be before the due date', () => {
    expect(checkPayByBeforeDue('2026-11-09', '2026-11-27').detail).toBe('Paid 18 days early');
    expect(checkPayByBeforeDue('2026-11-26', '2026-11-27').detail).toBe('Paid 1 day early');
    expect(checkPayByBeforeDue('2026-11-27', '2026-11-27').result).toBe('blocked');
  });

  it('three rounds at most', () => {
    expect(checkRoundLimit(1).result).toBe('pass');
    expect(checkRoundLimit(3).result).toBe('pass');
    expect(checkRoundLimit(4).result).toBe('blocked');
    expect(checkRoundLimit(0).result).toBe('blocked');
  });

  it('offers expire', () => {
    const exp = new Date('2026-11-12T18:00:00Z');
    expect(checkOfferExpiry(exp, new Date('2026-11-12T17:59:59Z')).result).toBe('pass');
    expect(checkOfferExpiry(exp, exp).result).toBe('blocked');
  });

  it("evaluates Maya's 1.20% counter to Harbor: allowed, but over the ceiling", () => {
    const checks = evaluateSupplierTerms(
      { maxDiscountBps: 120, doNotContact: ['pinecrest', 'birch'], costCeiling: dollars(60) },
      {
        clientId: 'harbor',
        amountDue: dollars(7500),
        dueDate: '2026-12-03',
        amountEarly: dollars(1750),
        discountBps: 120,
        payBy: TODAY,
        planCostIfAgreed: dollars(61),
        round: 2,
        today: TODAY,
      },
    );
    expect(isBlocked(checks)).toBe(false);
    expect(needsApproval(checks)).toBe(true);
    expect(allPass(checks)).toBe(false);
  });

  it("blocks Harbor's 1.50% ask on Maya's side", () => {
    const checks = evaluateSupplierTerms(
      { maxDiscountBps: 120, doNotContact: [], costCeiling: dollars(60) },
      {
        clientId: 'harbor',
        amountDue: dollars(7500),
        dueDate: '2026-12-03',
        amountEarly: dollars(1750),
        discountBps: 150,
        payBy: TODAY,
        planCostIfAgreed: dollars(66),
        round: 2,
        today: TODAY,
      },
    );
    expect(blockedRules(checks)).toEqual(['maxDiscount']);
    expect(needsApproval(checks)).toBe(false);
  });

  it('a reminder-free plan row with no discount skips the pay-by check', () => {
    const checks = evaluateSupplierTerms(
      { maxDiscountBps: 120, doNotContact: [], costCeiling: dollars(60) },
      {
        clientId: 'oak',
        amountDue: dollars(1800),
        dueDate: '2026-11-03',
        amountEarly: dollars(1800),
        discountBps: 0,
        payBy: TODAY,
        planCostIfAgreed: 0n,
        round: 1,
        today: TODAY,
      },
    );
    expect(checks.map((c) => c.rule)).not.toContain('payByBeforeDue');
    expect(allPass(checks)).toBe(true);
  });

  it('no supplier-approved terms ever exceed the max discount or reach a protected client (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.constantFrom('a', 'b', 'c'),
        (discount, max, client) => {
          const checks = evaluateSupplierTerms(
            { maxDiscountBps: max, doNotContact: ['b'], costCeiling: dollars(1000) },
            {
              clientId: client,
              amountDue: dollars(1000),
              dueDate: '2026-12-01',
              amountEarly: dollars(500),
              discountBps: discount,
              payBy: TODAY,
              planCostIfAgreed: dollars(10),
              round: 1,
              today: TODAY,
            },
          );
          if (!isBlocked(checks)) {
            expect(discount).toBeLessThanOrEqual(max);
            expect(client).not.toBe('b');
          }
        },
      ),
    );
  });
});

describe('client checks', () => {
  const harbor = {
    hurdleBps: 1500,
    cashBuffer: dollars(20000),
    autoPayLimit: dollars(2000),
    earlyPayCap: dollars(5000),
    neverPayEarly: [] as string[],
  };
  const offer = {
    supplierId: 'maya',
    amountEarly: dollars(1750),
    discountBps: 120,
    daysEarly: 24,
    cashAvailable: dollars(50000),
    round: 2,
    expiresAt: new Date('2026-11-12T18:00:00Z'),
    now: new Date('2026-11-09T12:00:00Z'),
  };

  it('Harbor accepts 1.20% on $1,750 (18.5% a year) and auto-pays $1,729', () => {
    const checks = evaluateClientOffer(harbor, offer);
    expect(allPass(checks)).toBe(true);
    expect(paymentFor(dollars(1750), 120)).toBe(dollars(1729));
  });

  it('Harbor rejects 0.80% (12.3% a year) against a 15% hurdle', () => {
    const checks = evaluateClientOffer(harbor, { ...offer, discountBps: 80 });
    expect(blockedRules(checks)).toEqual(['hurdleRate']);
    expect(checkHurdleRate(80, 24, 1500).detail).toBe('12.3% a year is below the 15.00% hurdle');
  });

  it("the full $7,500 breaks Harbor's $5,000 early-pay cap", () => {
    const checks = evaluateClientOffer(harbor, { ...offer, amountEarly: dollars(7500) });
    expect(blockedRules(checks)).toContain('earlyPayCap');
  });

  it("Juniper's $4,960 payment is above its $3,000 auto-pay limit: a person approves", () => {
    const juniper = { ...harbor, hurdleBps: 1200, autoPayLimit: dollars(3000), earlyPayCap: null };
    const checks = evaluateClientOffer(juniper, {
      ...offer,
      amountEarly: dollars(5000),
      discountBps: 80,
      daysEarly: 18,
    });
    expect(isBlocked(checks)).toBe(false);
    expect(needsApproval(checks)).toBe(true);
    expect(checkAutoPayLimit(dollars(4960), dollars(3000)).result).toBe('needs_approval');
  });

  it('cash buffer, cap and never-pay-early', () => {
    expect(checkCashBuffer(dollars(21000), dollars(1000), dollars(20000)).result).toBe('pass');
    expect(checkCashBuffer(dollars(21000), dollars(1001), dollars(20000)).result).toBe('blocked');
    expect(checkEarlyPayCap(dollars(9999), null).result).toBe('pass');
    expect(checkEarlyPayCap(dollars(5000), dollars(5000)).result).toBe('pass');
    expect(checkNeverPayEarly('maya', ['maya']).result).toBe('blocked');
    expect(checkNeverPayEarly('maya', []).result).toBe('pass');
  });

  it('an offer the client policy passes always meets the hurdle and keeps the buffer (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 500, max: 3000 }),
        fc.bigInt({ min: 0n, max: dollars(40000) }),
        (bps, days, hurdle, cash) => {
          const checks = evaluateClientOffer(
            { ...harbor, hurdleBps: hurdle },
            { ...offer, discountBps: bps, daysEarly: days, cashAvailable: cash },
          );
          if (!isBlocked(checks)) {
            expect(checkHurdleRate(bps, days, hurdle).result).toBe('pass');
            expect(cash - paymentFor(offer.amountEarly, bps)).toBeGreaterThanOrEqual(
              harbor.cashBuffer,
            );
          }
        },
      ),
    );
  });
});
