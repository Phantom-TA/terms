import { z } from 'zod';
import { ActionType, DealState, PlanItemRank, PlanReasonCode, PlanStatus } from '../enums.js';
import {
  AnnualRate,
  BusinessRef,
  Id,
  IsoDate,
  IsoDateTime,
  MoneyAmount,
  Percent,
  PolicyCheckView,
  PositiveMoney,
} from './common.js';

/** One row of a plan: the action chosen for one invoice. */
export const PlanItemView = z.object({
  id: Id,
  planId: Id,
  invoiceId: Id,
  invoiceNumber: z.string(),
  client: BusinessRef,
  action: ActionType,
  rank: PlanItemRank,
  /** Order in which backups run (1 = first). Null for primary rows. */
  backupOrder: z.number().int().min(1).nullable(),
  /** Null for NONE and REMINDER. */
  discountPct: Percent.nullable(),
  /** Portion pulled forward; null for NONE and REMINDER. */
  amountEarly: PositiveMoney.nullable(),
  payBy: IsoDate.nullable(),
  daysEarly: z.number().int().min(1).nullable(),
  impliedAnnualRate: AnnualRate.nullable(),
  /** Discount cost to the owner if agreed. */
  cost: MoneyAmount,
  /** Cash committed if agreed (amountEarly − discount); "0.00" for NONE and REMINDER. */
  committedIfAgreed: MoneyAmount,
  /** Reminders are best effort: false. Offers: true once agreed. */
  countsTowardGoal: z.boolean(),
  reasonCode: PlanReasonCode,
  /** Deterministic one-line reason, always present. */
  reason: z.string(),
  /** Plain-language explanation from the plan explainer model; null until generated. */
  explanation: z.string().nullable(),
  editedByOwner: z.boolean(),
  /**
   * Policy checks the server ran on this row when it was planned or last edited by the owner.
   * Empty for NONE rows with nothing to check (already paid, excluded by the owner).
   */
  policyChecks: z.array(PolicyCheckView),
  dealId: Id.nullable(),
  dealState: DealState.nullable(),
});
export type PlanItemView = z.infer<typeof PlanItemView>;

/** The numbers in the Workbench top rail. */
export const PlanSummary = z.object({
  /** The owner's stated gap G. */
  gap: MoneyAmount,
  /** Buffer B above the gap. */
  buffer: MoneyAmount,
  /** G + B. */
  target: MoneyAmount,
  /** Committed cash if every primary offer is accepted as planned. */
  plannedCommitted: MoneyAmount,
  /** Total discount cost if every primary offer is accepted as planned. */
  plannedCost: MoneyAmount,
  /** Cash from deals that are AGREED or later (never reminders). */
  committed: MoneyAmount,
  /** Cash PayPal has confirmed as paid against deals. */
  paid: MoneyAmount,
  /** Discount cost of deals that are AGREED or later. */
  costSoFar: MoneyAmount,
  /** Sum of invoices with a reminder; shown separately as best effort, never counted. */
  bestEffort: MoneyAmount,
  costCeiling: MoneyAmount,
  /** target − committed when positive, else "0.00". */
  remaining: MoneyAmount,
  /** True once committed ≥ target (the stop rule). */
  goalMet: z.boolean(),
  /** True when the plan as built cannot reach the target within the limits. */
  shortfall: z.boolean(),
});
export type PlanSummary = z.infer<typeof PlanSummary>;

export const Plan = z.object({
  id: Id,
  goalId: Id,
  status: PlanStatus,
  costCeiling: MoneyAmount,
  approvedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  summary: PlanSummary,
  /** Primary rows first (one per open invoice), then backups by backupOrder. */
  items: z.array(PlanItemView),
});
export type Plan = z.infer<typeof Plan>;

export const PlanResponse = z.object({ plan: Plan });
export type PlanResponse = z.infer<typeof PlanResponse>;

/** POST /api/goals/:id/plan — run the planner on a goal. */
export const CreatePlanRequest = z.strictObject({
  /** Defaults to the owner's policy ceiling. */
  costCeiling: MoneyAmount.optional(),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

/** PATCH /api/plans/:id/items/:itemId — owner edits a row of a DRAFT plan. */
export const UpdatePlanItemRequest = z
  .strictObject({
    action: ActionType.optional(),
    discountPct: Percent.optional(),
    amountEarly: PositiveMoney.optional(),
    /** Exclude this client from the plan (sets the action to NONE). */
    excluded: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must change');
export type UpdatePlanItemRequest = z.infer<typeof UpdatePlanItemRequest>;

export const UpdatePlanItemResponse = z.object({
  plan: Plan,
  /** Checks run on the edited row; blocked edits are rejected with 422 instead. */
  policyChecks: z.array(PolicyCheckView),
});
export type UpdatePlanItemResponse = z.infer<typeof UpdatePlanItemResponse>;

/** POST /api/plans/:id/approve — approve the plan and its cost ceiling; starts execution. */
export const ApprovePlanRequest = z.strictObject({
  costCeiling: MoneyAmount,
});
export type ApprovePlanRequest = z.infer<typeof ApprovePlanRequest>;
