/**
 * Annualised return to a payer who takes an early-payment discount.
 *
 *   r = d / (1 - d) × 365 / t
 *
 * where d is the discount and t the number of days paid early. All functions work on integer
 * basis points and whole days with exact rational arithmetic; the only rounding is the final,
 * documented rounding of a displayed value.
 */
import { assertBps, BPS_PER_UNIT, type Bps, divRoundHalfUp } from './money.js';

export const DAYS_PER_YEAR = 365;
/** Wire format for an annual rate in percent with one decimal ("18.5"). */
export const ANNUAL_RATE_PATTERN = /^\d+\.\d$/;

function assertDays(days: number): void {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`days early must be a positive integer, got ${String(days)}`);
  }
}

function assertDiscount(bps: Bps): void {
  assertBps(bps);
  if (bps >= BPS_PER_UNIT) throw new RangeError('a discount of 100% has no defined return');
}

/**
 * The implied annual rate in tenths of a percent, rounded half up.
 * 120 bps paid 24 days early → 185 (18.5% a year).
 */
export function impliedAnnualRateTenths(discountBps: Bps, daysEarly: number): number {
  assertDiscount(discountBps);
  assertDays(daysEarly);
  const numerator = 1000n * BigInt(discountBps) * BigInt(DAYS_PER_YEAR);
  const denominator = BigInt(BPS_PER_UNIT - discountBps) * BigInt(daysEarly);
  return Number(divRoundHalfUp(numerator, denominator));
}

/** The implied annual rate as a wire string with one decimal: (120, 24) → "18.5". */
export function impliedAnnualRate(discountBps: Bps, daysEarly: number): string {
  const tenths = impliedAnnualRateTenths(discountBps, daysEarly);
  return `${Math.floor(tenths / 10).toString()}.${(tenths % 10).toString()}`;
}

/**
 * Exact test that a discount paid `daysEarly` days early returns at least `rateBps` a year
 * (e.g. a 15% hurdle is 1500). No rounding: 1.20% over 24 days (18.47…%) meets 18.47% but not 18.5%.
 */
export function meetsAnnualRate(discountBps: Bps, daysEarly: number, rateBps: Bps): boolean {
  assertDiscount(discountBps);
  assertDays(daysEarly);
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new RangeError('rate must be integer bps');
  // d/(1-d) × 365/t ≥ R  ⇔  bps × 365 × 10000 ≥ R × (10000 − bps) × t
  const lhs = BigInt(discountBps) * BigInt(DAYS_PER_YEAR) * BigInt(BPS_PER_UNIT);
  const rhs = BigInt(rateBps) * BigInt(BPS_PER_UNIT - discountBps) * BigInt(daysEarly);
  return lhs >= rhs;
}

/**
 * The discount (bps) whose implied annual rate equals `rateBps`, rounded to the nearest `step`
 * (default 0.1% = 10 bps), half up. Used by client agents to counter at their target rate:
 * a 23% target over 24 days → 150 bps (1.5%).
 */
export function discountForAnnualRate(rateBps: Bps, daysEarly: number, step: Bps = 10): Bps {
  assertDays(daysEarly);
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new RangeError('rate must be integer bps');
  if (!Number.isInteger(step) || step < 1) throw new RangeError('step must be a positive integer');
  // d = k / (1 + k) with k = R·t / (365·10000); in bps: 10000·R·t / (3,650,000 + R·t)
  const rt = BigInt(rateBps) * BigInt(daysEarly);
  const yearBps = BigInt(DAYS_PER_YEAR) * BigInt(BPS_PER_UNIT);
  const steps = divRoundHalfUp(BigInt(BPS_PER_UNIT) * rt, (yearBps + rt) * BigInt(step));
  return Number(steps) * step;
}

/**
 * The smallest discount on a `step` grid (default 10 bps) that meets `rateBps` exactly.
 * Useful to explain "the lowest discount this client would accept".
 */
export function minDiscountMeetingRate(rateBps: Bps, daysEarly: number, step: Bps = 10): Bps {
  assertDays(daysEarly);
  if (!Number.isInteger(step) || step < 1) throw new RangeError('step must be a positive integer');
  for (let bps = 0; bps < BPS_PER_UNIT; bps += step) {
    if (meetsAnnualRate(bps, daysEarly, rateBps)) return bps;
  }
  throw new RangeError('no discount below 100% meets this rate');
}
