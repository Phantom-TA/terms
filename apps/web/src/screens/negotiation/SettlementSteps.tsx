import { type AuditEntry } from '@terms/shared';
import { ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { ErrorState } from '../../ui/ErrorState';
import { LoadingRegion, Skeleton } from '../../ui/Skeleton';
import { useDealAudit } from './queries';

/** Only entries that are PayPal's: a call Terms made, or a webhook PayPal sent. */
export function settlementSteps(entries: readonly AuditEntry[]): AuditEntry[] {
  return entries.filter((e) => e.paypalCall !== null || e.webhookVerified !== null).toReversed();
}

function Step({ entry }: { entry: AuditEntry }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {entry.paypalCall ? (
        <code className="rounded-sm border border-rule-strong bg-paper px-1.5 py-0.5 font-mono text-xs text-ink">
          {entry.paypalCall}
        </code>
      ) : null}
      {entry.webhookVerified === true ? (
        <Badge icon={<ShieldCheck aria-hidden className="size-3" />}>Verified webhook</Badge>
      ) : null}
      {entry.webhookVerified === false ? <Badge tone="danger">Webhook rejected</Badge> : null}
      <span className="text-base text-ink-2">{entry.summary}</span>
      <span className="text-xs text-ink-3">{formatDateTime(entry.at)}</span>
    </li>
  );
}

/** The PayPal calls behind this deal, from the audit log. */
export function SettlementSteps({ dealId }: { dealId: string }) {
  const audit = useDealAudit(dealId);

  return (
    <section aria-label="Settlement on PayPal" className="space-y-2">
      <h3 className="text-md">On PayPal</h3>
      {audit.isPending ? (
        <LoadingRegion label="Loading the PayPal steps">
          <Skeleton className="w-2/3" />
        </LoadingRegion>
      ) : null}
      {audit.isError ? (
        <ErrorState
          headingLevel="h3"
          title="Couldn’t load the PayPal steps"
          error={audit.error}
          onRetry={() => void audit.refetch()}
          retrying={audit.isFetching}
        />
      ) : null}
      {audit.data ? <Steps entries={settlementSteps(audit.data.entries)} /> : null}
    </section>
  );
}

function Steps({ entries }: { entries: readonly AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        Nothing yet. PayPal is only touched after both sides agree.
      </p>
    );
  }
  return (
    <ol className="space-y-1.5">
      {entries.map((entry) => (
        <Step key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}
