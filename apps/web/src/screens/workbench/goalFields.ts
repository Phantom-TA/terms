import {
  formatMoney,
  isIsoDate,
  normalizeMoneyInput,
  normalizePercentInput,
  percentToBps,
  toCents,
} from '@terms/shared';

/** Validation for the goal chips. These pre-check what the server will check again. */

export function validateAmount(raw: string): string | null {
  const money = normalizeMoneyInput(raw);
  if (money === null) return 'Enter an amount like 6200 or 6,200.50';
  return toCents(money) > 0n ? null : 'The amount must be more than zero';
}

export function validateDate(raw: string): string | null {
  return isIsoDate(raw) ? null : 'Use the form YYYY-MM-DD, for example 2026-11-13';
}

export function validatePercent(raw: string): string | null {
  return normalizePercentInput(raw) === null ? 'Enter a percentage like 1.2' : null;
}

export function validateOpening(raw: string, maxDiscountPct: string): string | null {
  const percent = normalizePercentInput(raw);
  if (percent === null) return 'Enter a percentage like 0.8';
  return percentToBps(percent) <= percentToBps(maxDiscountPct)
    ? null
    : `The opening discount can't be above your ${maxDiscountPct}% maximum`;
}

/** "6200.00" → "6200", so the editor opens with what a person would type. */
export function plainMoney(value: string): string {
  return value.replace(/\.00$/, '');
}

export function displayMoney(value: string): string {
  return formatMoney(value, { cents: 'auto' });
}
