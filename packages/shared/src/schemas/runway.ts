import { z } from 'zod';
import { CashEventKind } from '../enums.js';
import { Currency, Id, IsoDate, IsoDateTime, Money, MoneyAmount } from './common.js';

/** GET /api/runway — cash runway before and after the plan. Owner only. */
export const RunwayQuery = z.object({
  planId: Id.optional(),
  /** Days after today to project. Default 30. */
  horizonDays: z.coerce.number().int().min(7).max(120).default(30),
});
export type RunwayQuery = z.infer<typeof RunwayQuery>;

/** One day on the runway chart. Balances are end-of-day and signed. */
export const RunwayPoint = z.object({
  date: IsoDate,
  /** Confirmed balance plus confirmed recurring flows, with no plan. */
  before: Money,
  /** `before` plus cash from deals that are AGREED or later (committed only). */
  afterCommitted: Money,
  /** `afterCommitted` plus cash the plan would commit if every open offer is accepted. */
  afterPlanned: Money,
  /** `afterCommitted` plus reminded invoices paid on time. Best effort, drawn separately. */
  afterBestEffort: Money,
});
export type RunwayPoint = z.infer<typeof RunwayPoint>;

/** A dated movement drawn as a marker on the chart. */
export const RunwayEvent = z.object({
  date: IsoDate,
  /** Signed: negative for outflows. */
  amount: Money,
  kind: z.union([CashEventKind, z.enum(['DEAL_COMMITTED', 'DEAL_PAID', 'INVOICE_DUE'])]),
  label: z.string(),
  /** Whether this event is included in `afterCommitted`. */
  committed: z.boolean(),
});
export type RunwayEvent = z.infer<typeof RunwayEvent>;

/** A labelled horizontal reference line, e.g. the payroll threshold. */
export const RunwayThreshold = z.object({
  label: z.string(),
  amount: MoneyAmount,
  /** Date the obligation lands. */
  date: IsoDate,
});
export type RunwayThreshold = z.infer<typeof RunwayThreshold>;

export const RunwayResponse = z.object({
  currency: Currency,
  today: IsoDate,
  asOf: IsoDateTime,
  balance: Money,
  planId: Id.nullable(),
  deadline: IsoDate.nullable(),
  /** The goal's gap; "0.00" without a goal. */
  gap: MoneyAmount,
  committed: MoneyAmount,
  bestEffort: MoneyAmount,
  thresholds: z.array(RunwayThreshold),
  points: z.array(RunwayPoint),
  events: z.array(RunwayEvent),
});
export type RunwayResponse = z.infer<typeof RunwayResponse>;
