/**
 * Money maths. Amounts are integer cents held as `bigint`; on the wire they are decimal strings
 * with exactly two decimals ("1500.00"). Percentages are integer basis points (1.20% = 120 bps);
 * on the wire they are decimal strings with two decimals ("1.20"). No floats are used anywhere.
 */

/** Integer cents. */
export type Cents = bigint;
/** Integer basis points: 1% = 100 bps, 0.1% = 10 bps. */
export type Bps = number;

/** Wire format for money: optional minus, integer part without leading zeros, exactly two decimals. */
export const MONEY_PATTERN = /^-?(0|[1-9]\d*)\.\d{2}$/;
/** Wire format for a percentage with two decimals, from "0.00" to "100.00". */
export const PERCENT_PATTERN = /^(0|[1-9]\d?|100)\.\d{2}$/;

export const BPS_PER_UNIT = 10_000; // 100% = 10,000 bps
export const CENTS_PER_DOLLAR = 100n;

export class MoneyFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyFormatError';
  }
}

export function isMoneyString(value: string): boolean {
  return MONEY_PATTERN.test(value);
}

/** Parses a wire money string ("1500.00", "-12.50") into cents. Throws on any other format. */
export function toCents(value: string): Cents {
  if (!MONEY_PATTERN.test(value)) {
    throw new MoneyFormatError(`Invalid money string "${value}": expected e.g. "1500.00"`);
  }
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).replace('.', '');
  const cents = BigInt(digits);
  return negative ? -cents : cents;
}

/** Formats cents as a wire money string with two decimals. */
export function fromCents(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / CENTS_PER_DOLLAR;
  const frac = abs % CENTS_PER_DOLLAR;
  return `${negative ? '-' : ''}${whole.toString()}.${frac.toString().padStart(2, '0')}`;
}

/** Converts a whole-dollar integer into cents. */
export function dollars(amount: number | bigint): Cents {
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    throw new MoneyFormatError(`dollars() needs a safe integer, got ${String(amount)}`);
  }
  return BigInt(amount) * CENTS_PER_DOLLAR;
}

/**
 * Normalises human input ("$6,200", "6200", "6,200.5", " 1 500.00 ") into a wire money string.
 * Returns null when the input is not a plain non-negative amount with at most two decimals.
 */
export function normalizeMoneyInput(input: string): string | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/[,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = (match[2] ?? '').padEnd(2, '0');
  return fromCents(BigInt(whole) * CENTS_PER_DOLLAR + BigInt(frac));
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function minCents(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

/** Integer division of non-negative bigints, rounding half up. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new RangeError('numerator must be non-negative');
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Integer division of non-negative bigints, rounding up. */
export function divCeil(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator < 0n) throw new RangeError('numerator must be non-negative');
  return (numerator + denominator - 1n) / denominator;
}

export function assertBps(bps: Bps): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_PER_UNIT) {
    throw new RangeError(`basis points must be an integer in [0, 10000], got ${String(bps)}`);
  }
}

/**
 * The discount in cents on an amount: amount × bps / 10,000, rounded half up to the cent.
 * Example: $1,500.00 at 1.20% → $18.00.
 */
export function discountOn(amount: Cents, bps: Bps): Cents {
  assertBps(bps);
  if (amount < 0n) throw new RangeError('amount must be non-negative');
  return divRoundHalfUp(amount * BigInt(bps), BigInt(BPS_PER_UNIT));
}

/** Parses a wire percentage string ("1.20") into basis points (120). */
export function percentToBps(value: string): Bps {
  if (!PERCENT_PATTERN.test(value)) {
    throw new MoneyFormatError(`Invalid percentage "${value}": expected e.g. "1.20"`);
  }
  const [whole = '0', frac = '00'] = value.split('.');
  return Number(whole) * 100 + Number(frac);
}

/** Formats basis points as a wire percentage string: 120 → "1.20". */
export function bpsToPercent(bps: Bps): string {
  assertBps(bps);
  return `${Math.floor(bps / 100).toString()}.${(bps % 100).toString().padStart(2, '0')}`;
}

/**
 * Normalises human percentage input ("1.2", "1.2%", " 0.8 ") into a wire percentage string.
 * Returns null for anything that is not a number from 0 to 100 with at most two decimals.
 */
export function normalizePercentInput(input: string): string | null {
  const cleaned = input.trim().replace(/%$/, '').trim();
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= BPS_PER_UNIT ? bpsToPercent(bps) : null;
}

/** Rounds basis points down to a step (default 0.1% = 10 bps). */
export function floorBpsToStep(bps: Bps, step: Bps = 10): Bps {
  assertBps(bps);
  return Math.floor(bps / step) * step;
}

/**
 * The default opening discount: two-thirds of the maximum, rounded down to 0.1%.
 * Example: max 1.20% → 0.80%.
 */
export function defaultOpeningBps(maxBps: Bps): Bps {
  assertBps(maxBps);
  return Math.floor((maxBps * 2) / 30) * 10;
}

/** Rounds cents down to a whole multiple of a step (e.g. $250 steps for partial amounts). */
export function floorToStep(amount: Cents, step: Cents): Cents {
  if (step <= 0n) throw new RangeError('step must be positive');
  if (amount < 0n) throw new RangeError('amount must be non-negative');
  return (amount / step) * step;
}

export interface FormatMoneyOptions {
  /** ISO 4217 currency code; only USD gets a symbol, other currencies are suffixed. Default USD. */
  currency?: string;
  /** 'always' shows cents; 'auto' hides ".00" on whole amounts. Default 'always'. */
  cents?: 'always' | 'auto';
}

/** Human display: toCents("6200.00") → "$6,200.00" (or "$6,200" with cents: 'auto'). */
export function formatMoney(value: string | Cents, options: FormatMoneyOptions = {}): string {
  const cents = typeof value === 'bigint' ? value : toCents(value);
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = (abs / CENTS_PER_DOLLAR).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % CENTS_PER_DOLLAR).toString().padStart(2, '0');
  const showCents = (options.cents ?? 'always') === 'always' || frac !== '00';
  const number = showCents ? `${whole}.${frac}` : whole;
  const currency = options.currency ?? 'USD';
  const body = currency === 'USD' ? `$${number}` : `${number} ${currency}`;
  return negative ? `-${body}` : body;
}
