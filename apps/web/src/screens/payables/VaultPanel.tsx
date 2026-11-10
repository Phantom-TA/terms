import { type VaultStatus } from '@terms/shared';
import { Wallet } from 'lucide-react';
import { browser } from '../../lib/browser';
import { formatDateTime, type Tone } from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/ErrorState';
import { LoadingRegion, Skeleton } from '../../ui/Skeleton';
import { useVault, useVaultSetup } from './queries';

const STATUS: Readonly<Record<VaultStatus, { label: string; tone: Tone }>> = {
  NONE: { label: 'Not saved', tone: 'neutral' },
  PENDING: { label: 'Waiting for PayPal', tone: 'warn' },
  ACTIVE: { label: 'Saved', tone: 'info' },
  FAILED: { label: 'Failed', tone: 'danger' },
  REVOKED: { label: 'Removed', tone: 'neutral' },
};

/**
 * The PayPal method the agent pays from. Saving it takes one approval by a person, on PayPal's own
 * page; the app only learns it worked when PayPal says so.
 */
export function VaultPanel() {
  const vault = useVault();
  const setup = useVaultSetup();

  const start = async () => {
    try {
      const { approvalUrl } = await setup.mutateAsync();
      browser.assign(approvalUrl);
    } catch {
      // Shown below from the mutation's error.
    }
  };

  const status = vault.data ? STATUS[vault.data.status] : null;
  return (
    <Card
      title="Saved PayPal method"
      description="Your agent pays from this within its auto-pay limit."
      {...(status ? { actions: <Badge tone={status.tone}>{status.label}</Badge> } : {})}
    >
      {vault.isPending ? (
        <LoadingRegion label="Loading the saved method">
          <Skeleton className="w-1/2" />
        </LoadingRegion>
      ) : null}
      {vault.isError ? (
        <ErrorState
          title="Couldn’t check the saved method"
          error={vault.error}
          onRetry={() => void vault.refetch()}
          retrying={vault.isFetching}
        />
      ) : null}
      {vault.data ? (
        <div className="space-y-3">
          {vault.data.status === 'ACTIVE' ? (
            <p className="flex items-center gap-2 text-base text-ink">
              <Wallet aria-hidden className="size-4 text-ink-3" />
              {vault.data.payerEmail ?? 'PayPal account'}
              {vault.data.updatedAt ? (
                <span className="text-sm text-ink-3">
                  since {formatDateTime(vault.data.updatedAt)}
                </span>
              ) : null}
            </p>
          ) : (
            <>
              <p className="text-base text-ink-2">
                {vault.data.status === 'PENDING'
                  ? 'A person started this but hasn’t finished approving it on PayPal.'
                  : 'Without a saved method, every payment needs a person to approve it on PayPal.'}
              </p>
              <Button variant="primary" onClick={() => void start()} loading={setup.isPending}>
                {vault.data.status === 'PENDING' ? 'Finish on PayPal' : 'Save a PayPal method'}
              </Button>
            </>
          )}
          {setup.isError ? (
            <ErrorState
              title="Couldn’t start saving the method"
              error={setup.error}
              onRetry={() => void start()}
              retrying={setup.isPending}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
