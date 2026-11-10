import { type MessageType, MAX_NEGOTIATION_ROUNDS, type NegotiationMessage } from '@terms/shared';
import clsx from 'clsx';
import { type ReactNode } from 'react';
import {
  formatAnnualRate,
  formatDate,
  formatDateTime,
  formatPercent,
  MESSAGE_TYPE_LABEL,
  type Tone,
} from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { Money, PolicyBadges } from '../../ui/finance';

const TYPE_TONE: Readonly<Record<MessageType, Tone>> = {
  OFFER: 'info',
  COUNTER: 'warn',
  ACCEPT: 'committed',
  DECLINE: 'neutral',
  WITHDRAW: 'neutral',
};

export function isSupplierMessage(message: Pick<NegotiationMessage, 'from'>): boolean {
  return message.from.startsWith('supplier:');
}

export function partyLabel(
  message: Pick<NegotiationMessage, 'actor' | 'from'>,
  clientName: string,
  supplierName: string,
): string {
  switch (message.actor) {
    case 'OWNER':
      return 'You';
    case 'CLIENT_HUMAN':
      return `${clientName} (a person)`;
    default:
      return isSupplierMessage(message) ? `${supplierName}’s agent` : `${clientName}’s agent`;
  }
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="figures text-base text-ink">{children}</dd>
    </div>
  );
}

export interface MessageCardProps {
  message: NegotiationMessage;
  clientName: string;
  supplierName: string;
  /** Only the latest message can still be open. */
  latest?: boolean;
}

/** One move: who made it, the terms, the return, and what each policy check said. */
export function MessageCard({
  message,
  clientName,
  supplierName,
  latest = false,
}: MessageCardProps) {
  const supplier = isSupplierMessage(message);
  const party = partyLabel(message, clientName, supplierName);
  const { terms } = message;
  return (
    <article
      aria-label={`${party}: ${MESSAGE_TYPE_LABEL[message.type]}, round ${message.round}`}
      className={clsx(
        'animate-enter space-y-2 rounded-lg border border-t-2 border-rule bg-surface p-3',
        supplier ? 'border-t-supplier' : 'border-t-client',
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={clsx('font-medium', supplier ? 'text-supplier' : 'text-client')}>
          {party}
        </span>
        <span className="text-xs text-ink-3">
          Round {message.round} of {MAX_NEGOTIATION_ROUNDS} · {formatDateTime(message.createdAt)}
        </span>
      </header>

      <Badge tone={TYPE_TONE[message.type]}>{MESSAGE_TYPE_LABEL[message.type]}</Badge>

      {terms ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Term label="Paid early">
            <Money value={terms.amountEarly} />
          </Term>
          <Term label="Discount">{formatPercent(terms.discountPct)}</Term>
          {message.payNow ? (
            <Term label="Pays now">
              <Money value={message.payNow} />
            </Term>
          ) : null}
          {message.impliedAnnualRate ? (
            <Term label="Client’s return">{formatAnnualRate(message.impliedAnnualRate)}</Term>
          ) : null}
          <Term label="Pay by">{formatDate(terms.payBy)}</Term>
          {terms.remainderDue ? (
            <Term label="Rest due">{formatDate(terms.remainderDue)}</Term>
          ) : null}
        </dl>
      ) : null}

      {message.note ? <p className="text-base text-ink-2">“{message.note}”</p> : null}
      {message.policyChecks.length > 0 ? <PolicyBadges checks={message.policyChecks} /> : null}
      {latest && message.expiresAt ? (
        <p className="text-xs text-ink-3">Open until {formatDateTime(message.expiresAt)}</p>
      ) : null}
    </article>
  );
}
