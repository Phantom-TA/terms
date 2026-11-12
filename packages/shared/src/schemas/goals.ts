import { z } from 'zod';
import { BalanceSource, CashEventKind, CashEventSource, GoalStatus } from '../enums.js';
import { Id, IsoDate, IsoDateTime, Money, MoneyAmount, Percent, PositiveMoney } from './common.js';
import { Plan } from './plans.js';

/** Max length of the owner's goal sentence. */
export const GOAL_TEXT_MAX_LENGTH = 500;

/** A name from the owner's "don't contact" phrase, matched to a client where possible. */
export const DoNotContactEntry = z.object({
  /** The name as the owner wrote it. */
  name: z.string(),
  /** The matched client, or null when no client matched (the UI asks the owner to pick). */
  businessId: Id.nullable(),
  matchedName: z.string().nullable(),
});
export type DoNotContactEntry = z.infer<typeof DoNotContactEntry>;

/** A known cash movement before the deadline. */
export const ForecastFlow = z.object({
  date: IsoDate,
  /** Signed: negative for outflows. */
  amount: Money,
  kind: CashEventKind,
  label: z.string(),
  source: CashEventSource,
});
export type ForecastFlow = z.infer<typeof ForecastFlow>;

/**
 * The forecaster's check of the stated goal against PayPal history (CONTEXT.md, "How it works" 2.2).
 * Only confirmed flows are used; no payment probabilities.
 */
export const GoalForecast = z.object({
  balance: Money,
  balanceSource: BalanceSource,
  balanceAsOf: IsoDateTime,
  /** Confirmed flows between today and the deadline. */
  flows: z.array(ForecastFlow),
  /** balance + flows on the deadline, before the plan. */
  projectedBalance: Money,
  /** max(0, −projectedBalance): the gap the history implies. */
  impliedGap: MoneyAmount,
  /**
   * CONFIRMED: the implied gap matches the stated amount (within $10);
   * QUESTIONED: they differ and `message` says how;
   * INSUFFICIENT_DATA: no recurring outflow found before the deadline.
   */
  verdict: z.enum(['CONFIRMED', 'QUESTIONED', 'INSUFFICIENT_DATA']),
  /** e.g. "Payroll of $11,400 lands Friday; your balance is $5,200; the gap is $6,200 — confirmed". */
  message: z.string(),
});
export type GoalForecast = z.infer<typeof GoalForecast>;

export const Goal = z.object({
  id: Id,
  rawText: z.string(),
  /** Gap G. */
  amount: PositiveMoney,
  deadline: IsoDate,
  maxDiscountPct: Percent,
  /** Default: two-thirds of the maximum, rounded down to 0.1%. */
  openingDiscountPct: Percent,
  doNotContact: z.array(DoNotContactEntry),
  bufferPct: Percent,
  /** amount × (1 + buffer), rounded half up to the cent. */
  target: PositiveMoney,
  status: GoalStatus,
  forecast: GoalForecast.nullable(),
  /** Fields the parser could not read from the sentence and filled from the owner's policy. */
  defaultedFields: z.array(z.enum(['maxDiscountPct', 'bufferPct', 'doNotContact', 'deadline'])),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Goal = z.infer<typeof Goal>;

export const GoalResponse = z.object({ goal: Goal });
export type GoalResponse = z.infer<typeof GoalResponse>;

/**
 * GET /api/goals/current — the owner's latest goal that is not cancelled, with its latest plan.
 * Both are null on a fresh account. The Workbench loads this first.
 */
export const CurrentGoalResponse = z.object({
  goal: Goal.nullable(),
  plan: Plan.nullable(),
});
export type CurrentGoalResponse = z.infer<typeof CurrentGoalResponse>;

/** POST /api/goals — parse the owner's sentence into a goal for confirmation. */
export const CreateGoalRequest = z.strictObject({
  text: z.string().trim().min(1).max(GOAL_TEXT_MAX_LENGTH),
});
export type CreateGoalRequest = z.infer<typeof CreateGoalRequest>;

/** PATCH /api/goals/:id — the owner edits parsed fields (the chips) before planning. */
export const UpdateGoalRequest = z
  .strictObject({
    amount: PositiveMoney.optional(),
    deadline: IsoDate.optional(),
    maxDiscountPct: Percent.optional(),
    openingDiscountPct: Percent.optional(),
    bufferPct: Percent.optional(),
    /** Replaces the do-not-contact list with these client IDs. */
    doNotContactIds: z.array(Id).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must change');
export type UpdateGoalRequest = z.infer<typeof UpdateGoalRequest>;
