import { type DealDetail, type NegotiationMessage } from '@terms/shared';
import { type CustomCellRendererProps } from 'ag-grid-react';
import { Link } from 'react-router-dom';
import { formatDateTime, formatPercent } from '../../lib/display';
import { ErrorState } from '../../ui/ErrorState';
import { closingReason } from '../negotiation/closingReason';
import { Money, PolicyBadges, ProtectedTag } from '../../ui/finance';
import { Skeleton } from '../../ui/Skeleton';
import { useDeal } from './queries';
import { type AnyRow, isInvoiceRow, type WorkbenchRow } from './rows';

const PARTY: Readonly<Record<string, string>> = {
  supplier: 'Your agent',
  client: 'Client agent',
};

function partyName(ref: string): string {
  const side = ref.split(':')[0] ?? '';
  return PARTY[side] ?? ref;
}

function MessageLine({ message }: { message: NegotiationMessage }) {
  const terms = message.terms;
  return (
    <li className="space-y-1 border-l-2 border-rule pl-3">
      <p className="text-base">
        <span className="font-medium">{partyName(message.from)}</span>{' '}
        <span className="text-ink-2">
          {message.type.toLowerCase()}
          {terms ? (
            <>
              {' '}
              <Money value={terms.amountEarly} /> at {formatPercent(terms.discountPct)}
              {message.impliedAnnualRate ? ` (${message.impliedAnnualRate}% a year)` : ''}
            </>
          ) : null}
        </span>
      </p>
      {message.note ? <p className="text-sm text-ink-2">“{message.note}”</p> : null}
      {message.policyChecks.length > 0 ? <PolicyBadges checks={message.policyChecks} /> : null}
    </li>
  );
}

function Transcript({ row }: { row: WorkbenchRow }) {
  const deal = useDeal(row.dealId);

  if (row.dealId === null) {
    return row.contactAllowed ? (
      <p className="text-sm text-ink-3">
        {row.approval === 'awaiting-plan'
          ? 'Nothing has been sent. Nothing is sent until you approve the plan.'
          : 'Nothing has been sent for this invoice.'}
      </p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <ProtectedTag /> Terms will never message this client.
      </p>
    );
  }
  if (deal.isPending) {
    return (
      <div role="status" aria-busy="true" className="space-y-2">
        <span className="sr-only">Loading the transcript</span>
        <Skeleton className="w-3/4" />
        <Skeleton className="w-1/2" />
      </div>
    );
  }
  if (deal.isError) {
    return (
      <ErrorState
        title="Couldn’t load the transcript"
        error={deal.error}
        onRetry={() => void deal.refetch()}
        retrying={deal.isFetching}
      />
    );
  }
  return <TranscriptBody deal={deal.data} />;
}

function TranscriptBody({ deal }: { deal: DealDetail }) {
  return (
    <div className="space-y-3">
      {deal.messages.length === 0 ? (
        <p className="text-sm text-ink-3">
          No messages yet. Nothing is sent until you approve the plan.
        </p>
      ) : (
        <ul aria-label="Negotiation transcript" className="space-y-2">
          {deal.messages.map((message) => (
            <MessageLine key={message.id} message={message} />
          ))}
        </ul>
      )}
      {closingReason(deal) ? (
        <p className="text-sm text-ink-2">Closed: {closingReason(deal)}</p>
      ) : null}
      <ol aria-label="Deal history" className="space-y-0.5 text-xs text-ink-3">
        {deal.history.map((step) => (
          <li key={`${step.to}-${step.at}`}>
            {formatDateTime(step.at)} · {step.to.replaceAll('_', ' ').toLowerCase()} · {step.reason}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The master-detail row: why the planner chose this action, and what has been said so far. */
export function DetailPanel({ data }: CustomCellRendererProps<AnyRow>) {
  if (!isInvoiceRow(data)) return null;
  const item = data.item;
  return (
    <div
      role="gridcell"
      data-testid={`detail-${data.id}`}
      className="grid w-full gap-6 bg-paper px-6 py-4 whitespace-normal md:grid-cols-2"
    >
      <section aria-label="Why this row" className="space-y-2">
        <h2 className="text-md">Why this row</h2>
        {item ? (
          <>
            <p className="text-base text-ink">{item.reason}</p>
            {item.explanation ? <p className="text-base text-ink-2">{item.explanation}</p> : null}
            {item.editedByOwner ? (
              <p className="text-sm text-ink-3">You changed this row.</p>
            ) : null}
            {item.policyChecks.length > 0 ? (
              <div className="pt-1">
                <h3 className="text-base">Policy checks</h3>
                <PolicyBadges checks={item.policyChecks} />
              </div>
            ) : null}
            {data.invoice.backups.length > 0 ? (
              <div className="pt-1">
                <h3 className="text-base">If another offer is declined</h3>
                <ul aria-label="Backup offers" className="text-sm text-ink-2">
                  {data.invoice.backups.map((backup) => (
                    <li key={backup.id}>
                      Backup {backup.backupOrder}:{' '}
                      {backup.amountEarly ? <Money value={backup.amountEarly} /> : null}
                      {backup.discountPct ? ` at ${formatPercent(backup.discountPct)}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-3">State a goal and Terms will plan this invoice.</p>
        )}
      </section>
      <section aria-label="Negotiation" className="space-y-2">
        <h2 className="text-md">What has been said</h2>
        <Transcript row={data} />
        {data.dealId && !data.bestEffort ? (
          <Link
            to={`/negotiation?deal=${encodeURIComponent(data.dealId)}`}
            className="inline-block text-sm font-medium text-ink underline underline-offset-2"
          >
            Open in the Negotiation Room
          </Link>
        ) : null}
      </section>
    </div>
  );
}
