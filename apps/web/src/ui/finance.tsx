import {
  type ActionType,
  type DealState,
  formatMoney,
  type PolicyResult,
  type PolicyRule,
} from '@terms/shared';
import clsx from 'clsx';
import { Ban, Check, Hand, ShieldCheck, X } from 'lucide-react';
import { type ReactNode } from 'react';
import {
  ACTION_LABEL,
  DEAL_STATE_DISPLAY,
  POLICY_RESULT_DISPLAY,
  POLICY_RULE_LABEL,
} from '../lib/display';
import { Badge } from './Badge';

export function DealStatePill({ state }: { state: DealState }) {
  const display = DEAL_STATE_DISPLAY[state];
  return (
    <Badge tone={display.tone} dot pulse={display.waiting} title={display.description}>
      {display.label}
    </Badge>
  );
}

const POLICY_ICONS: Readonly<Record<PolicyResult, ReactNode>> = {
  pass: <Check aria-hidden className="size-3" />,
  blocked: <X aria-hidden className="size-3" />,
  needs_approval: <Hand aria-hidden className="size-3" />,
};

export interface PolicyCheckLike {
  rule: PolicyRule;
  result: PolicyResult;
  detail: string;
}

export function PolicyBadge({ check }: { check: PolicyCheckLike }) {
  const result = POLICY_RESULT_DISPLAY[check.result];
  return (
    <Badge tone={result.tone} icon={POLICY_ICONS[check.result]} title={check.detail}>
      {POLICY_RULE_LABEL[check.rule]}
      <span className="sr-only">
        : {result.label}. {check.detail}
      </span>
      {check.result === 'pass' ? null : <span aria-hidden>· {result.label.toLowerCase()}</span>}
    </Badge>
  );
}

export function PolicyBadges({ checks }: { checks: readonly PolicyCheckLike[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {checks.map((check) => (
        <PolicyBadge key={check.rule} check={check} />
      ))}
    </span>
  );
}

export interface MoneyProps {
  /** A wire money string from the server, e.g. "1482.00". */
  value: string;
  currency?: string;
  /** Draw it in the accent. Only for cash that is committed. */
  committed?: boolean;
  className?: string;
}

export function Money({ value, currency = 'USD', committed = false, className }: MoneyProps) {
  return (
    <span className={clsx('figures', committed && 'font-medium text-committed-strong', className)}>
      {formatMoney(value, { currency })}
    </span>
  );
}

/** Original amount struck through, with what is actually paid after it. Both from the server. */
export function MoneyWithDiscount({
  original,
  discounted,
  currency = 'USD',
  committed = false,
}: {
  original: string;
  discounted: string;
  currency?: string;
  committed?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <s className="figures text-sm text-ink-3">
        <span className="sr-only">Was </span>
        {formatMoney(original, { currency })}
      </s>
      <span>
        <span className="sr-only">Now </span>
        <Money value={discounted} currency={currency} committed={committed} />
      </span>
    </span>
  );
}

export function ActionTag({ action }: { action: ActionType }) {
  return <span className="text-base text-ink">{ACTION_LABEL[action]}</span>;
}

/** Reminders never count toward the goal, and this tag has to say so wherever one appears. */
export function BestEffortTag() {
  return (
    <span className="inline-flex items-center rounded-sm border border-dashed border-rule-strong px-1.5 py-0.5 text-xs whitespace-nowrap text-ink-2">
      Best effort, not counted
    </span>
  );
}

export function ProtectedTag() {
  return (
    <Badge
      tone="protected"
      icon={<Ban aria-hidden className="size-3" />}
      title="On the do-not-contact list. Terms will never message this client."
    >
      Do not contact
    </Badge>
  );
}

export function AgentTag({ hasAgent }: { hasAgent: boolean }) {
  return hasAgent ? (
    <Badge icon={<ShieldCheck aria-hidden className="size-3" />}>Has agent</Badge>
  ) : (
    <span className="text-sm text-ink-3">Human</span>
  );
}
