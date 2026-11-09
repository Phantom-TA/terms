import {
  type ActionType,
  type DealState,
  type PayPalInvoiceStatus,
  type PolicyResult,
  type PolicyRule,
  toEpochDay,
} from '@terms/shared';

/** Visual tones. `committed` is the accent and means cash committed, nothing else. */
export type Tone =
  'neutral' | 'info' | 'warn' | 'danger' | 'committed' | 'committed-solid' | 'protected';

export interface DealStateDisplay {
  label: string;
  tone: Tone;
  /** True while the deal waits on something outside Terms, so the pill shows a live dot. */
  waiting: boolean;
  description: string;
}

export const DEAL_STATE_DISPLAY: Readonly<Record<DealState, DealStateDisplay>> = {
  SUGGESTED: {
    label: 'Suggested',
    tone: 'neutral',
    waiting: false,
    description: 'In the plan, not yet approved',
  },
  APPROVED: {
    label: 'Approved',
    tone: 'info',
    waiting: false,
    description: 'You approved this; it has not been sent',
  },
  SENT: {
    label: 'Sent',
    tone: 'info',
    waiting: true,
    description: 'Offer delivered; waiting for the client',
  },
  COUNTERED: {
    label: 'Countered',
    tone: 'warn',
    waiting: false,
    description: 'The client proposed different terms',
  },
  NEEDS_OWNER: {
    label: 'Needs you',
    tone: 'warn',
    waiting: false,
    description: 'This counter is above the plan and needs your approval',
  },
  AGREED: {
    label: 'Agreed',
    tone: 'committed',
    waiting: false,
    description: 'Both sides accepted these exact terms',
  },
  INVOICE_UPDATED: {
    label: 'Invoice updated',
    tone: 'committed',
    waiting: false,
    description: 'The PayPal invoice now matches the terms',
  },
  AWAITING_PAYMENT: {
    label: 'Awaiting payment',
    tone: 'committed',
    waiting: true,
    description: 'Waiting for PayPal to confirm the payment',
  },
  PAID: {
    label: 'Paid',
    tone: 'committed-solid',
    waiting: false,
    description: 'Confirmed by PayPal',
  },
  PARTIALLY_PAID: {
    label: 'Partially paid',
    tone: 'committed-solid',
    waiting: false,
    description: 'Partial payment confirmed by PayPal',
  },
  DECLINED: { label: 'Declined', tone: 'neutral', waiting: false, description: 'Closed: declined' },
  EXPIRED: { label: 'Expired', tone: 'neutral', waiting: false, description: 'Closed: expired' },
  WITHDRAWN: {
    label: 'Withdrawn',
    tone: 'neutral',
    waiting: false,
    description: 'Closed: no longer needed',
  },
  FAILED: { label: 'Failed', tone: 'danger', waiting: false, description: 'Closed: a step failed' },
  REMOVED: {
    label: 'Removed',
    tone: 'neutral',
    waiting: false,
    description: 'You removed this from the plan',
  },
};

export const ACTION_LABEL: Readonly<Record<ActionType, string>> = {
  NONE: 'No action',
  REMINDER: 'Reminder',
  PARTIAL_PAYMENT: 'Partial payment',
  EARLY_DISCOUNT: 'Early-payment discount',
  NEGOTIATE: 'Negotiate',
};

export const POLICY_RULE_LABEL: Readonly<Record<PolicyRule, string>> = {
  maxDiscount: 'Max discount',
  doNotContact: 'Do not contact',
  costCeiling: 'Cost ceiling',
  overdueNoDiscount: 'No discount when overdue',
  amountWithinInvoice: 'Amount within invoice',
  payByBeforeDue: 'Pay-by before due',
  roundLimit: 'Round limit',
  offerExpiry: 'Offer expiry',
  hurdleRate: 'Hurdle rate',
  cashBuffer: 'Cash buffer',
  autoPayLimit: 'Auto-pay limit',
  earlyPayCap: 'Early-pay cap',
  neverPayEarly: 'Never pay early',
};

export const POLICY_RESULT_DISPLAY: Readonly<Record<PolicyResult, { label: string; tone: Tone }>> =
  {
    pass: { label: 'Pass', tone: 'neutral' },
    blocked: { label: 'Blocked', tone: 'danger' },
    needs_approval: { label: 'Needs approval', tone: 'warn' },
  };

export const PAYPAL_STATUS_LABEL: Readonly<Record<PayPalInvoiceStatus, string>> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  SCHEDULED: 'Scheduled',
  UNPAID: 'Unpaid',
  PAYMENT_PENDING: 'Payment pending',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  MARKED_AS_PAID: 'Marked as paid',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially refunded',
  MARKED_AS_REFUNDED: 'Marked as refunded',
};

const DAY_MS = 86_400_000;

function dateFromIso(value: string): Date {
  return new Date(toEpochDay(value) * DAY_MS);
}

const shortDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "2026-11-13" → "Fri, Nov 13". A calendar date, so it never shifts with the viewer's time zone. */
export function formatDate(value: string): string {
  return shortDate.format(dateFromIso(value));
}

export function formatDateTime(value: string): string {
  return dateTime.format(new Date(value));
}

/** daysUntilDue → "in 18 days", "due today", "6 days overdue". */
export function formatDueIn(daysUntilDue: number): string {
  if (daysUntilDue === 0) return 'due today';
  const days = Math.abs(daysUntilDue);
  const unit = days === 1 ? 'day' : 'days';
  return daysUntilDue > 0 ? `in ${days} ${unit}` : `${days} ${unit} overdue`;
}

/** "18.5" → "18.5% a year". */
export function formatAnnualRate(rate: string): string {
  return `${rate}% a year`;
}

/** "1.20" → "1.2%", "1.25" → "1.25%", "1.00" → "1%". */
export function formatPercent(value: string): string {
  return `${value.replace(/\.?0+$/, '')}%`;
}
