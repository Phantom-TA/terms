import {
  type ActionType,
  type DealState,
  type InvoiceRow,
  type PayPalInvoiceStatus,
  type PlanItemView,
  type PlanStatus,
  type PlanSummary,
} from '@terms/shared';
import { ACTION_LABEL } from '../../lib/display';

/** What the Approval column says about a row. */
export type ApprovalStatus =
  /** A counter or payment is waiting on the owner. */
  | 'needs-you'
  /** The plan is still a draft, so nothing here has been approved. */
  | 'awaiting-plan'
  /** The owner approved the plan this row is part of. */
  | 'approved'
  | null;

export interface WorkbenchRow {
  kind: 'invoice';
  id: string;
  invoice: InvoiceRow;
  item: PlanItemView | null;
  clientId: string;
  clientName: string;
  number: string;
  amountDue: string;
  dueDate: string;
  daysUntilDue: number;
  paypalStatus: PayPalInvoiceStatus;
  contactAllowed: boolean;
  hasAgent: boolean;
  action: ActionType;
  /** Grid group: protected clients are grouped apart so they are visibly protected. */
  groupLabel: string;
  amountEarly: string | null;
  discountPct: string | null;
  /** Annualised return to the client, from the server. */
  rate: string | null;
  /** Discount cost if agreed. */
  cost: string;
  /** Cash this row commits if agreed. Planned, not committed. */
  ifAgreed: string;
  /** Cash the deal commits now, only once the server says it counts. */
  committed: string | null;
  /** True for a reminder: it is shown as best effort and never counted. */
  bestEffort: boolean;
  dealState: DealState | null;
  dealId: string | null;
  approval: ApprovalStatus;
  /** A change to this row is on its way to the server. */
  saving?: boolean;
}

export interface SummaryRow {
  kind: 'summary';
  id: '__summary';
  label: string;
  cost: string;
  ifAgreed: string;
  committed: string;
}

export const PROTECTED_GROUP = 'Do not contact';

/** Offers first, then reminders, then rows with nothing to do, with protected clients last. */
export function groupRank(label: string): number {
  if (label === PROTECTED_GROUP) return 4;
  if (label === ACTION_LABEL.NONE) return 3;
  if (label === ACTION_LABEL.REMINDER) return 2;
  return 1;
}

export function groupLabelFor(contactAllowed: boolean, action: ActionType): string {
  return contactAllowed ? ACTION_LABEL[action] : PROTECTED_GROUP;
}

function approvalFor(
  row: InvoiceRow,
  action: ActionType,
  planStatus: PlanStatus | null,
): ApprovalStatus {
  if (row.deal?.pendingApprovalId) return 'needs-you';
  if (planStatus === null || action === 'NONE') return null;
  if (planStatus === 'DRAFT') return 'awaiting-plan';
  return planStatus === 'APPROVED' || planStatus === 'MET' ? 'approved' : null;
}

const CLOSED_STATUSES: readonly PayPalInvoiceStatus[] = [
  'PAID',
  'MARKED_AS_PAID',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'MARKED_AS_REFUNDED',
];

/**
 * Open invoices, plus closed ones that are part of the plan. A deal that has just been paid must
 * stay on screen as PAID, not vanish at the moment it succeeds.
 */
export function belongsOnWorkbench(row: InvoiceRow): boolean {
  return !CLOSED_STATUSES.includes(row.paypalStatus) || row.planItem !== null;
}

interface CachedRow {
  planStatus: PlanStatus | null;
  row: WorkbenchRow;
}

const rowCache = new WeakMap<InvoiceRow, CachedRow>();

/**
 * One grid row per invoice. Every figure is the server's; nothing is calculated here. An unchanged
 * invoice keeps the same row object, because AG Grid treats a new object as a changed row, and
 * that would close an editor the owner has open in it.
 */
export function toWorkbenchRows(
  invoices: readonly InvoiceRow[],
  planStatus: PlanStatus | null,
): WorkbenchRow[] {
  return invoices.filter(belongsOnWorkbench).map((invoice) => {
    const cached = rowCache.get(invoice);
    if (cached?.planStatus === planStatus) return cached.row;
    const row = toRow(invoice, planStatus);
    rowCache.set(invoice, { planStatus, row });
    return row;
  });
}

function toRow(invoice: InvoiceRow, planStatus: PlanStatus | null): WorkbenchRow {
  const item = invoice.planItem;
  const action = item?.action ?? 'NONE';
  const deal = invoice.deal;
  const isOffer = action !== 'NONE' && action !== 'REMINDER';
  return {
    kind: 'invoice',
    id: invoice.id,
    invoice,
    item,
    clientId: invoice.client.id,
    clientName: invoice.client.name,
    number: invoice.number,
    amountDue: invoice.amountDue,
    dueDate: invoice.dueDate,
    daysUntilDue: invoice.daysUntilDue,
    paypalStatus: invoice.paypalStatus,
    contactAllowed: invoice.contactAllowed,
    hasAgent: invoice.client.hasAgent,
    action,
    groupLabel: groupLabelFor(invoice.contactAllowed, action),
    amountEarly: item?.amountEarly ?? null,
    discountPct: item?.discountPct ?? null,
    rate: item?.impliedAnnualRate ?? null,
    cost: item?.cost ?? '0.00',
    ifAgreed: item?.committedIfAgreed ?? '0.00',
    committed: deal?.countsAsCommitted ? deal.committedIfAgreed : null,
    bestEffort: action === 'REMINDER',
    // Deals are created when the plan is approved. Until then the row is simply suggested.
    dealState:
      deal?.state ??
      item?.dealState ??
      (planStatus === 'DRAFT' && action !== 'NONE' ? 'SUGGESTED' : null),
    dealId: deal?.id ?? item?.dealId ?? null,
    approval: isOffer || action === 'REMINDER' ? approvalFor(invoice, action, planStatus) : null,
  };
}

/** The pinned bottom row. Totals come from the server's plan summary. */
export function toSummaryRow(summary: PlanSummary): SummaryRow {
  return {
    kind: 'summary',
    id: '__summary',
    label: 'Plan total',
    cost: summary.plannedCost,
    ifAgreed: summary.plannedCommitted,
    committed: summary.committed,
  };
}

export type AnyRow = WorkbenchRow | SummaryRow;

export function isInvoiceRow(row: AnyRow | undefined): row is WorkbenchRow {
  return row?.kind === 'invoice';
}
