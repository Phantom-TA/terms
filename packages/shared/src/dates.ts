/**
 * Calendar-date helpers on ISO dates ("2026-11-13"). Dates are treated as calendar days with no
 * time zone, so day differences never drift across daylight-saving changes.
 */

export const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class DateFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateFormatError';
  }
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

/** Days since 1970-01-01 for an ISO date. */
export function toEpochDay(value: string): number {
  if (!isIsoDate(value)) throw new DateFormatError(`Invalid ISO date "${value}"`);
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

/** ISO date for a count of days since 1970-01-01. */
export function fromEpochDay(day: number): string {
  if (!Number.isInteger(day)) throw new DateFormatError(`Epoch day must be an integer, got ${day}`);
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return fromEpochDay(toEpochDay(value) + days);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(to: string, from: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function compareDates(a: string, b: string): -1 | 0 | 1 {
  const d = diffDays(a, b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** The calendar date of an instant in a given IANA time zone (default UTC). */
export function isoDateInTimeZone(instant: Date, timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Day of the week for an ISO date: 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: string): number {
  // 1970-01-01 was a Thursday (4).
  return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}

/**
 * The next given weekday strictly after `from` when `strict`, otherwise on or after it.
 * nextWeekday("2026-11-09", 5) → "2026-11-13" (the next Friday).
 */
export function nextWeekday(from: string, weekday: number, strict = false): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError('weekday must be 0..6');
  }
  let delta = (weekday - dayOfWeek(from) + 7) % 7;
  if (delta === 0 && strict) delta = 7;
  return addDays(from, delta);
}
