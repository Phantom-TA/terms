/** Conversions between database values and @terms/shared wire formats. */
import { fromCents } from '@terms/shared';

/** A Postgres DATE column (UTC midnight) → "YYYY-MM-DD". */
export function dateToIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → a Date at UTC midnight for a DATE column. */
export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function money(cents: bigint): string {
  return fromCents(cents);
}

export function moneyOrNull(cents: bigint | null): string | null {
  return cents === null ? null : fromCents(cents);
}

const SECRET_KEY =
  /(secret|password|authorization|cookie|api_?key|access_?token|refresh_?token|^token$|offer_?token)/i;

/**
 * Makes a value safe to store as JSON in the audit trail: bigint → string, Date → ISO string,
 * and any key that names a secret or token is replaced with "[redacted]".
 */
export function toAuditJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => toAuditJson(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : toAuditJson(v, depth + 1);
    }
    return out;
  }
  return value;
}
