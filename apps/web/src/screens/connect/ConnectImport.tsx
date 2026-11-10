import { type BalanceSource, formatMoney, type SyncResponse } from '@terms/shared';
import { CheckCircle2, CloudDownload } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { formatDateTime } from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { useConnection, useConnectionLive, useSync } from './queries';

const BALANCE_SOURCE: Readonly<Record<BalanceSource, string>> = {
  PAYPAL_BALANCES: 'From PayPal’s balances',
  LEDGER: 'From Terms’ ledger of verified PayPal transactions',
};

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="figures font-display text-xl text-ink">{value}</dd>
      {hint ? <dd className="text-sm text-ink-3">{hint}</dd> : null}
    </div>
  );
}

function SyncResult({ sync }: { sync: SyncResponse }) {
  const { invoices, transactions } = sync;
  return (
    <div
      role="status"
      className="space-y-1 rounded-md border border-rule bg-paper px-3 py-2 text-base"
    >
      <p className="flex items-center gap-2 font-medium text-ink">
        <CheckCircle2 aria-hidden className="size-4" />
        Imported from PayPal at {formatDateTime(sync.syncedAt)}
      </p>
      <p className="text-ink-2">
        Invoices: {invoices.imported} new, {invoices.updated} updated, {invoices.unchanged}{' '}
        unchanged, {invoices.total} in PayPal.
      </p>
      <p className="text-ink-2">
        Transactions: {transactions.imported} new, {transactions.total} in all
        {transactions.coveredFrom && transactions.coveredTo
          ? `, covering ${formatDateTime(transactions.coveredFrom)} to ${formatDateTime(transactions.coveredTo)}`
          : ''}
        . PayPal’s transaction reporting can lag by a few hours.
      </p>
    </div>
  );
}

export function Component() {
  useConnectionLive();
  const connection = useConnection();
  const sync = useSync();
  const { toast } = useToast();
  const [result, setResult] = useState<SyncResponse | null>(null);

  const run = async () => {
    try {
      const response = await sync.mutateAsync();
      setResult(response);
      toast({
        tone: 'success',
        title: 'Imported from PayPal',
        description: `${response.invoices.total} invoices checked.`,
      });
    } catch {
      // Shown below from the mutation's error.
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-4 lg:px-6">
      <header>
        <h1 className="text-xl">Connect and import</h1>
        <p className="text-base text-ink-2">
          Terms reads your open invoices and recent transactions from PayPal. Nothing needs typing
          in.
        </p>
      </header>

      {connection.isPending ? (
        <SkeletonRows rows={3} columns={4} label="Loading the connection" />
      ) : null}
      {connection.isError && !connection.data ? (
        <ErrorState
          title="Couldn’t check the PayPal connection"
          error={connection.error}
          onRetry={() => void connection.refetch()}
          retrying={connection.isFetching}
        />
      ) : null}

      {connection.data ? (
        <>
          <Card
            title="PayPal"
            {...(connection.data.paypal.accountEmail
              ? { description: connection.data.paypal.accountEmail }
              : {})}
            actions={
              connection.data.paypal.connected ? (
                <Badge tone="info">Connected</Badge>
              ) : (
                <Badge tone="danger">Not connected</Badge>
              )
            }
          >
            <dl className="flex flex-wrap gap-x-10 gap-y-3 text-base">
              <div>
                <dt className="text-sm text-ink-3">Environment</dt>
                <dd>{connection.data.paypal.environment === 'sandbox' ? 'Sandbox' : 'Live'}</dd>
              </div>
              {connection.data.paypal.merchantId ? (
                <div>
                  <dt className="text-sm text-ink-3">Merchant ID</dt>
                  <dd className="font-mono text-sm">{connection.data.paypal.merchantId}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-sm text-ink-3">Last imported</dt>
                <dd>
                  {connection.data.lastSyncedAt
                    ? formatDateTime(connection.data.lastSyncedAt)
                    : 'Never'}
                </dd>
              </div>
              {connection.data.demo ? (
                <div>
                  <dt className="text-sm text-ink-3">Data</dt>
                  <dd>Demo data from the seed script</dd>
                </div>
              ) : null}
            </dl>
            {connection.data.paypal.connected ? null : (
              <p className="mt-3 text-base text-ink-2">
                The server has no working PayPal credentials, so nothing can be imported.
              </p>
            )}
          </Card>

          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Open invoices" value={connection.data.counts.openInvoices} />
            <Stat label="All invoices" value={connection.data.counts.allInvoices} />
            <Stat label="Transactions" value={connection.data.counts.transactions} />
            {connection.data.balance ? (
              <Stat
                label="Balance"
                value={formatMoney(connection.data.balance.available, {
                  currency: connection.data.balance.currency,
                })}
                hint={BALANCE_SOURCE[connection.data.balance.source]}
              />
            ) : null}
          </dl>

          <section aria-labelledby="import-heading" className="space-y-3">
            <h2 id="import-heading" className="text-lg">
              Import
            </h2>
            {connection.data.paypal.connected ? (
              <Button
                variant="primary"
                icon={<CloudDownload aria-hidden className="size-4" />}
                onClick={() => void run()}
                loading={sync.isPending}
              >
                Import from PayPal
              </Button>
            ) : null}
            {sync.isPending ? (
              <p role="status" className="text-base text-ink-2">
                Reading invoices and transactions from PayPal…
              </p>
            ) : null}
            {sync.isError ? (
              <ErrorState
                title="The import didn’t finish"
                error={sync.error}
                onRetry={() => void run()}
                retrying={sync.isPending}
              />
            ) : null}
            {result && !sync.isPending ? <SyncResult sync={result} /> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
