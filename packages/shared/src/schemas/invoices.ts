import { z } from 'zod';
import { PayPalInvoiceStatus } from '../enums.js';
import {
  BusinessRef,
  Currency,
  Id,
  IsoDate,
  IsoDateTime,
  MoneyAmount,
  PayPalId,
  PositiveMoney,
} from './common.js';
import { DealSummary } from './deals.js';
import { PlanItemView } from './plans.js';

/** One Workbench row: an invoice mirrored from PayPal plus its row in the current plan. */
export const InvoiceRow = z.object({
  id: Id,
  paypalInvoiceId: PayPalId,
  /** Invoice number as shown in PayPal, e.g. "1043". */
  number: z.string(),
  client: BusinessRef,
  amount: PositiveMoney,
  currency: Currency,
  amountPaid: MoneyAmount,
  amountDue: MoneyAmount,
  issueDate: IsoDate.nullable(),
  dueDate: IsoDate,
  /** Days from today to the due date; negative when overdue. */
  daysUntilDue: z.number().int(),
  paypalStatus: PayPalInvoiceStatus,
  /** False when the client is on the do-not-contact list (owner policy or the current goal). */
  contactAllowed: z.boolean(),
  /** Link to the invoice on PayPal (sandbox), for the owner to inspect. */
  paypalUrl: z.url().nullable(),
  isDemo: z.boolean(),
  lastSyncedAt: IsoDateTime,
  /** The primary row for this invoice in the selected plan; null without a plan. */
  planItem: PlanItemView.nullable(),
  /** Backup rows for this invoice in the selected plan. */
  backups: z.array(PlanItemView),
  /** The live deal for this invoice in the selected plan, if one exists. */
  deal: DealSummary.nullable(),
});
export type InvoiceRow = z.infer<typeof InvoiceRow>;

/** GET /api/invoices — Workbench rows. Owner only. */
export const ListInvoicesQuery = z.object({
  /** Plan whose rows to join; defaults to the current plan. */
  planId: Id.optional(),
  /** Include paid and cancelled invoices. Default false (open invoices only). */
  includeClosed: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuery>;

export const ListInvoicesResponse = z.object({
  rows: z.array(InvoiceRow),
  planId: Id.nullable(),
  /** Today's date in the owner's time zone; daysUntilDue is relative to it. */
  today: IsoDate,
  lastSyncedAt: IsoDateTime.nullable(),
  demo: z.boolean(),
});
export type ListInvoicesResponse = z.infer<typeof ListInvoicesResponse>;
