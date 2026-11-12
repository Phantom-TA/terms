import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  DateFormatError,
  dayOfWeek,
  diffDays,
  fromEpochDay,
  isIsoDate,
  isoDateInTimeZone,
  nextWeekday,
  toEpochDay,
} from '../src/dates.js';
import {
  discountForAnnualRate,
  impliedAnnualRate,
  impliedAnnualRateTenths,
  meetsAnnualRate,
  minDiscountMeetingRate,
} from '../src/rates.js';

describe('implied annual rate', () => {
  it('matches CONTEXT.md examples', () => {
    expect(impliedAnnualRate(100, 18)).toBe('20.5');
    expect(impliedAnnualRate(120, 24)).toBe('18.5');
    expect(impliedAnnualRate(80, 18)).toBe('16.4'); // Juniper accepts 0.8%
    expect(impliedAnnualRate(80, 24)).toBe('12.3'); // Harbor declines 0.8%
    expect(impliedAnnualRateTenths(0, 10)).toBe(0);
  });

  it('rejects bad inputs', () => {
    expect(() => impliedAnnualRate(120, 0)).toThrow(RangeError);
    expect(() => impliedAnnualRate(120, 1.5)).toThrow(RangeError);
    expect(() => impliedAnnualRate(10000, 10)).toThrow(RangeError);
  });

  it('hurdle comparisons are exact', () => {
    expect(meetsAnnualRate(80, 18, 1200)).toBe(true); // 16.4% ≥ 12%
    expect(meetsAnnualRate(80, 24, 1500)).toBe(false); // 12.3% < 15%
    expect(meetsAnnualRate(120, 24, 1500)).toBe(true); // 18.5% ≥ 15%
    // 18.47…% meets 18.47% but not 18.48%, even though it displays as 18.5
    expect(meetsAnnualRate(120, 24, 1847)).toBe(true);
    expect(meetsAnnualRate(120, 24, 1848)).toBe(false);
    expect(() => meetsAnnualRate(120, 24, -1)).toThrow(RangeError);
  });

  it('a higher discount or fewer days never lowers the return (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 2, max: 365 }),
        fc.integer({ min: 0, max: 10000 }),
        (bps, days, hurdle) => {
          if (meetsAnnualRate(bps, days, hurdle)) {
            expect(meetsAnnualRate(bps + 1, days, hurdle)).toBe(true);
            expect(meetsAnnualRate(bps, days - 1, hurdle)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('discount for a target rate', () => {
  it('Harbor: 23% target over 24 days → 1.5%', () => {
    expect(discountForAnnualRate(2300, 24)).toBe(150);
  });

  it('Juniper: 20% target over 18 days → 1.0%', () => {
    expect(discountForAnnualRate(2000, 18)).toBe(100);
  });

  it('result is within half a step of the exact target (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 5000 }), fc.integer({ min: 1, max: 120 }), (r, t) => {
        const bps = discountForAnnualRate(r, t);
        expect(bps % 10).toBe(0);
        // The step below misses the target, or the step above exceeds it.
        if (bps >= 10) expect(meetsAnnualRate(bps + 10, t, r)).toBe(true);
      }),
    );
  });

  it('minimum discount meeting a rate', () => {
    expect(minDiscountMeetingRate(1500, 24)).toBe(100); // 1.0% → 15.4%
    expect(minDiscountMeetingRate(1200, 18)).toBe(60); // 0.6% → 12.2%
    expect(() => minDiscountMeetingRate(1500, 24, 0)).toThrow(RangeError);
    expect(() => discountForAnnualRate(-1, 24)).toThrow(RangeError);
    expect(() => discountForAnnualRate(100, 24, 0)).toThrow(RangeError);
  });
});

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-11-13')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-3')).toBe(false);
    expect(() => toEpochDay('nope')).toThrow(DateFormatError);
    expect(() => fromEpochDay(1.5)).toThrow(DateFormatError);
  });

  it('adds and diffs calendar days across DST and month ends', () => {
    expect(addDays('2026-11-09', 18)).toBe('2026-11-27');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(diffDays('2026-12-03', '2026-11-09')).toBe(24);
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0);
    expect(compareDates('2026-01-03', '2026-01-02')).toBe(1);
  });

  it('round-trips epoch days (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), (d) => {
        expect(toEpochDay(fromEpochDay(d))).toBe(d);
      }),
    );
  });

  it('finds the next Friday', () => {
    expect(dayOfWeek('2026-11-09')).toBe(1); // Monday
    expect(nextWeekday('2026-11-09', 5)).toBe('2026-11-13');
    expect(nextWeekday('2026-11-13', 5)).toBe('2026-11-13');
    expect(nextWeekday('2026-11-13', 5, true)).toBe('2026-11-20');
    expect(() => nextWeekday('2026-11-13', 7)).toThrow(RangeError);
  });

  it('gives the calendar date in a time zone', () => {
    const instant = new Date('2026-11-10T03:00:00Z');
    expect(isoDateInTimeZone(instant)).toBe('2026-11-10');
    expect(isoDateInTimeZone(instant, 'America/Los_Angeles')).toBe('2026-11-09');
  });
});
