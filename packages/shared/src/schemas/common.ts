import { z } from 'zod';
import { isIsoDate } from '../dates.js';
import { PolicyResult, PolicyRule } from '../enums.js';
import { BPS_PER_UNIT, MONEY_PATTERN, PERCENT_PATTERN, percentToBps } from '../money.js';
import { ANNUAL_RATE_PATTERN } from '../rates.js';

/** Signed money as a decimal string with exactly two decimals: "1500.00", "-11400.00". */
export const Money = z
  .string()
  .regex(MONEY_PATTERN, 'Money must be a decimal string with two decimals, e.g. "1500.00"');
export type Money = z.infer<typeof Money>;

/** Non-negative money. */
export const MoneyAmount = Money.refine((v) => !v.startsWith('-'), 'Amount must not be negative');
export type MoneyAmount = z.infer<typeof MoneyAmount>;

/** Positive money. */
export const PositiveMoney = MoneyAmount.refine(
  (v) => /[1-9]/.test(v),
  'Amount must be more than zero',
);
export type PositiveMoney = z.infer<typeof PositiveMoney>;

/** A percentage with two decimals from "0.00" to "100.00", e.g. a discount of "1.20". */
export const Percent = z
  .string()
  .regex(PERCENT_PATTERN, 'Percent must have two decimals, e.g. "1.20"')
  .refine(
    (v) => !PERCENT_PATTERN.test(v) || percentToBps(v) <= BPS_PER_UNIT,
    'Percent must be at most 100',
  );
export type Percent = z.infer<typeof Percent>;

/** An annualised rate in percent with one decimal, e.g. "18.5". */
export const AnnualRate = z
  .string()
  .regex(ANNUAL_RATE_PATTERN, 'Annual rate must have one decimal, e.g. "18.5"');
export type AnnualRate = z.infer<typeof AnnualRate>;

export const IsoDate = z.string().refine(isIsoDate, 'Must be a calendar date in YYYY-MM-DD form');
export type IsoDate = z.infer<typeof IsoDate>;

export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const Currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code, e.g. "USD"');
export type Currency = z.infer<typeof Currency>;

/** Terms record ID (cuid2 or similar opaque string). */
export const Id = z.string().min(1).max(64);
export type Id = z.infer<typeof Id>;

/** PayPal object ID (invoice, order, capture, event). Opaque. */
export const PayPalId = z.string().min(1).max(128);
export type PayPalId = z.infer<typeof PayPalId>;

/** A negotiating party: "supplier:maya-studio", "client:harbor-co". */
export const PartyRef = z
  .string()
  .regex(/^(supplier|client):[a-z0-9][a-z0-9-]*$/, 'Party must look like "client:harbor-co"');
export type PartyRef = z.infer<typeof PartyRef>;

export const PolicyCheckView = z.object({
  rule: PolicyRule,
  result: PolicyResult,
  detail: z.string(),
});
export type PolicyCheckView = z.infer<typeof PolicyCheckView>;

/** A lightweight business reference used inside other records. */
export const BusinessRef = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  hasAgent: z.boolean(),
});
export type BusinessRef = z.infer<typeof BusinessRef>;

/** Pagination query: opaque cursor plus page size. */
export const PageQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PageQuery = z.infer<typeof PageQuery>;
