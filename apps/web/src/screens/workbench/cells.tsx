import { type CustomCellRendererProps } from 'ag-grid-react';
import clsx from 'clsx';
import {
  formatAnnualRate,
  formatDate,
  formatDueIn,
  formatPercent,
  PAYPAL_STATUS_LABEL,
} from '../../lib/display';
import { Badge } from '../../ui/Badge';
import {
  ActionTag,
  AgentTag,
  BestEffortTag,
  DealStatePill,
  Money,
  MoneyWithDiscount,
  ProtectedTag,
} from '../../ui/finance';
import { type AnyRow, type ApprovalStatus, isInvoiceRow } from './rows';

type Props<V = unknown> = CustomCellRendererProps<AnyRow, V>;

/** Cells for the Workbench grid. They show what the row says and hold no logic of their own. */

export function ClientCell({ data, value }: Props<string>) {
  if (data && !isInvoiceRow(data)) {
    return <span className="font-medium text-ink">{data.label}</span>;
  }
  return <span className="font-medium text-ink">{value}</span>;
}

export function AmountCell({ value }: Props<string | null>) {
  return value ? <Money value={value} /> : null;
}

export function DueCell({ data }: Props) {
  if (!isInvoiceRow(data)) return null;
  const overdue = data.daysUntilDue < 0;
  return (
    <span className="flex flex-col leading-tight">
      <span className={clsx(overdue && 'font-medium text-danger')}>
        {formatDueIn(data.daysUntilDue)}
      </span>
      <span className="text-xs text-ink-3">{formatDate(data.dueDate)}</span>
    </span>
  );
}

export function PayPalStatusCell({ data }: Props) {
  return isInvoiceRow(data) ? <span>{PAYPAL_STATUS_LABEL[data.paypalStatus]}</span> : null;
}

export function ContactCell({ data }: Props) {
  if (!isInvoiceRow(data)) return null;
  return data.contactAllowed ? <span className="text-ink-2">Allowed</span> : <ProtectedTag />;
}

export function AgentCell({ data }: Props) {
  return isInvoiceRow(data) ? <AgentTag hasAgent={data.hasAgent} /> : null;
}

/** The action, with a hint that it can be changed. Protected clients show why they can't. */
export function ActionCell({ data }: Props) {
  if (!isInvoiceRow(data)) return null;
  return <ActionTag action={data.action} />;
}

/** What is asked early, with the discount struck through and what the client actually pays. */
export function AskCell({ data }: Props) {
  if (!isInvoiceRow(data) || data.amountEarly === null) return null;
  return <MoneyWithDiscount original={data.amountEarly} discounted={data.ifAgreed} />;
}

export function DiscountCell({ data }: Props) {
  if (!isInvoiceRow(data) || data.discountPct === null) return null;
  return <span className="figures">{formatPercent(data.discountPct)}</span>;
}

export function RateCell({ data }: Props) {
  if (!isInvoiceRow(data) || data.rate === null) return null;
  return <span className="figures text-ink-2">{formatAnnualRate(data.rate)}</span>;
}

/** Cost to the owner. Blank where nothing is offered. */
export function CostCell({ data, value }: Props<string | null>) {
  if (isInvoiceRow(data) && (data.item?.discountPct ?? null) === null) return null;
  return value ? <Money value={value} /> : null;
}

/** Cash this row commits if agreed. Planned only, so it is muted. */
export function IfAgreedCell({ data, value }: Props<string | null>) {
  if (isInvoiceRow(data) && (data.item?.discountPct ?? null) === null) return null;
  return value ? <Money value={value} className="text-ink-2" /> : null;
}

/** Committed cash, in the accent, only once the server says the deal counts. Reminders never do. */
export function CommittedCell({ data, value }: Props<string | null>) {
  if (isInvoiceRow(data)) {
    if (data.bestEffort) return <BestEffortTag />;
    return value ? <Money value={value} committed /> : null;
  }
  return value ? <Money value={value} committed /> : null;
}

export function DealStateCell({ data }: Props) {
  if (!isInvoiceRow(data) || data.dealState === null) return null;
  return <DealStatePill state={data.dealState} />;
}

const APPROVAL: Readonly<
  Record<NonNullable<ApprovalStatus>, { label: string; tone: 'warn' | 'neutral' | 'info' }>
> = {
  'needs-you': { label: 'Needs you', tone: 'warn' },
  'awaiting-plan': { label: 'Not yet approved', tone: 'neutral' },
  approved: { label: 'Approved by you', tone: 'info' },
};

export function ApprovalCell({ data }: Props) {
  if (!isInvoiceRow(data) || data.approval === null) return null;
  const { label, tone } = APPROVAL[data.approval];
  return <Badge tone={tone}>{label}</Badge>;
}
