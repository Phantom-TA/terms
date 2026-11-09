import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bpsToPercent,
  defaultOpeningBps,
  discountOn,
  divCeil,
  divRoundHalfUp,
  dollars,
  floorBpsToStep,
  floorToStep,
  formatMoney,
  fromCents,
  isMoneyString,
  maxCents,
  minCents,
  MoneyFormatError,
  normalizeMoneyInput,
  normalizePercentInput,
  percentToBps,
  sumCents,
  toCents,
} from '../src/money.js';

describe('toCents / fromCents', () => {
  it('parses wire money strings exactly', () => {
    expect(toCents('1500.00')).toBe(150000n);
    expect(toCents('0.01')).toBe(1n);
    expect(toCents('-11400.00')).toBe(-1140000n);
    expect(toCents('0.00')).toBe(0n);
  });

  it.each(['1500', '1500.0', '1500.000', '01.00', '1,500.00', '$1.00', '', '-', '1e3', ' 1.00'])(
    'rejects %j',
    (bad) => {
      expect(() => toCents(bad)).toThrow(MoneyFormatError);
      expect(isMoneyString(bad)).toBe(false);
    },
  );

  it('formats cents with two decimals', () => {
    expect(fromCents(150000n)).toBe('1500.00');
    expect(fromCents(5n)).toBe('0.05');
    expect(fromCents(-1140000n)).toBe('-11400.00');
  });

  it('round-trips any amount (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), (c) => {
        expect(toCents(fromCents(c))).toBe(c);
      }),
    );
  });

  it('dollars() converts whole dollars', () => {
    expect(dollars(6200)).toBe(620000n);
    expect(dollars(7n)).toBe(700n);
    expect(() => dollars(1.5)).toThrow(MoneyFormatError);
  });
});

describe('normalizeMoneyInput', () => {
  it.each([
    ['$6,200', '6200.00'],
    ['6200', '6200.00'],
    ['6,200.5', '6200.50'],
    [' 1 500.00 ', '1500.00'],
    ['0.7', '0.70'],
    ['12.', '12.00'],
  ])('%j → %j', (input, out) => {
    expect(normalizeMoneyInput(input)).toBe(out);
  });

  it.each(['-5', 'abc', '1.234', '', '$'])('rejects %j', (input) => {
    expect(normalizeMoneyInput(input)).toBeNull();
  });
});

describe('arithmetic helpers', () => {
  it('sum, min, max', () => {
    expect(sumCents([1n, 2n, 3n])).toBe(6n);
    expect(sumCents([])).toBe(0n);
    expect(minCents(1n, 2n)).toBe(1n);
    expect(maxCents(1n, 2n)).toBe(2n);
  });

  it('divRoundHalfUp rounds halves up', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(7n, 3n)).toBe(2n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(-1n, 2n)).toThrow(RangeError);
  });

  it('divCeil rounds up', () => {
    expect(divCeil(7n, 3n)).toBe(3n);
    expect(divCeil(6n, 3n)).toBe(2n);
    expect(() => divCeil(1n, 0n)).toThrow(RangeError);
    expect(() => divCeil(-1n, 1n)).toThrow(RangeError);
  });

  it('floorToStep rounds down to $250 steps', () => {
    expect(floorToStep(dollars(1999), dollars(250))).toBe(dollars(1750));
    expect(() => floorToStep(1n, 0n)).toThrow(RangeError);
    expect(() => floorToStep(-1n, 1n)).toThrow(RangeError);
  });
});

describe('discountOn', () => {
  it('matches the CONTEXT.md examples', () => {
    expect(discountOn(dollars(1500), 120)).toBe(dollars(18)); // Harbor split example
    expect(discountOn(dollars(5000), 80)).toBe(dollars(40)); // Juniper
    expect(discountOn(dollars(1750), 120)).toBe(dollars(21)); // Harbor agreed
  });

  it('rounds half up to the cent', () => {
    expect(discountOn(125n, 100)).toBe(1n); // 1.25c → 1c
    expect(discountOn(150n, 100)).toBe(2n); // 1.5c → 2c
  });

  it('never exceeds the amount and is monotone in the rate (property)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.integer({ min: 0, max: 9999 }),
        (amount, bps) => {
          const d = discountOn(amount, bps);
          expect(d).toBeGreaterThanOrEqual(0n);
          expect(d).toBeLessThanOrEqual(amount);
          expect(discountOn(amount, bps + 1)).toBeGreaterThanOrEqual(d);
        },
      ),
    );
  });

  it('rejects bad inputs', () => {
    expect(() => discountOn(-1n, 10)).toThrow(RangeError);
    expect(() => discountOn(1n, 1.5)).toThrow(RangeError);
    expect(() => discountOn(1n, 10001)).toThrow(RangeError);
  });
});

describe('percentages', () => {
  it('converts between wire strings and bps', () => {
    expect(percentToBps('1.20')).toBe(120);
    expect(percentToBps('0.80')).toBe(80);
    expect(percentToBps('100.00')).toBe(10000);
    expect(bpsToPercent(120)).toBe('1.20');
    expect(bpsToPercent(5)).toBe('0.05');
    expect(() => percentToBps('1.2')).toThrow(MoneyFormatError);
  });

  it('round-trips (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (bps) => {
        expect(percentToBps(bpsToPercent(bps))).toBe(bps);
      }),
    );
  });

  it('normalizes human input', () => {
    expect(normalizePercentInput('1.2')).toBe('1.20');
    expect(normalizePercentInput(' 1.2% ')).toBe('1.20');
    expect(normalizePercentInput('101')).toBeNull();
    expect(normalizePercentInput('x')).toBeNull();
  });

  it('default opening discount is two-thirds of the maximum, rounded down to 0.1%', () => {
    expect(defaultOpeningBps(120)).toBe(80);
    expect(defaultOpeningBps(150)).toBe(100);
    expect(defaultOpeningBps(100)).toBe(60);
    expect(floorBpsToStep(127)).toBe(120);
  });

  it('opening discount never exceeds the maximum (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), (max) => {
        const open = defaultOpeningBps(max);
        expect(open).toBeLessThanOrEqual(max);
        expect(open % 10).toBe(0);
      }),
    );
  });
});

describe('formatMoney', () => {
  it('formats for display', () => {
    expect(formatMoney('6200.00')).toBe('$6,200.00');
    expect(formatMoney('6200.00', { cents: 'auto' })).toBe('$6,200');
    expect(formatMoney('6200.50', { cents: 'auto' })).toBe('$6,200.50');
    expect(formatMoney(-1140000n)).toBe('-$11,400.00');
    expect(formatMoney('12.00', { currency: 'EUR' })).toBe('12.00 EUR');
    expect(formatMoney('1234567.89')).toBe('$1,234,567.89');
  });
});
