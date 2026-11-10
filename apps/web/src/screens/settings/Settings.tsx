import { type BusinessRef } from '@terms/shared';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBusinesses, useSession } from '../../app/session';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { useConnection } from '../connect/queries';
import { VaultPanel } from '../payables/VaultPanel';
import { useSupplierPolicy } from '../workbench/queries';
import { ClientPolicyCard } from './ClientPolicyCard';
import { SupplierPolicyForm } from './SupplierPolicyForm';

const LINK = 'font-medium text-ink underline underline-offset-2';

function OwnerPolicy() {
  const policy = useSupplierPolicy();
  const businesses = useBusinesses();
  // Every client, and any already blocked, so a block can always be lifted.
  const clients = useMemo<BusinessRef[]>(() => {
    const all = (businesses.data ?? [])
      .filter((b) => b.role === 'CLIENT')
      .map(({ id, name, slug, hasAgent }): BusinessRef => ({ id, name, slug, hasAgent }));
    const byId = new Map(all.map((c) => [c.id, c]));
    for (const blocked of policy.data?.doNotContact ?? []) byId.set(blocked.id, blocked);
    return [...byId.values()];
  }, [businesses.data, policy.data]);
  return (
    <Card
      title="Your policy"
      description="Your standing limits. A goal can tighten them for one goal."
    >
      {policy.isPending ? <SkeletonRows rows={3} columns={2} label="Loading your policy" /> : null}
      {policy.isError ? (
        <ErrorState
          title="Couldn’t load your policy"
          error={policy.error}
          onRetry={() => void policy.refetch()}
          retrying={policy.isFetching}
        />
      ) : null}
      {policy.data ? (
        <SupplierPolicyForm key={policy.data.updatedAt} policy={policy.data} clients={clients} />
      ) : null}
    </Card>
  );
}

function OwnerConnection() {
  const connection = useConnection();
  return (
    <Card title="PayPal account">
      {connection.data ? (
        <p className="text-base text-ink">
          {connection.data.paypal.connected ? 'Connected' : 'Not connected'}
          {connection.data.paypal.accountEmail
            ? ` as ${connection.data.paypal.accountEmail}`
            : ''}.{' '}
          <Link to="/connect" className={LINK}>
            Connect and import
          </Link>
        </p>
      ) : connection.isError ? (
        <ErrorState
          title="Couldn’t check PayPal"
          error={connection.error}
          onRetry={() => void connection.refetch()}
          retrying={connection.isFetching}
        />
      ) : (
        <SkeletonRows rows={1} columns={2} label="Checking PayPal" />
      )}
    </Card>
  );
}

/** Policies, the PayPal account, and which environment this is. */
export function Component() {
  const session = useSession();
  const owner = session.data?.business.role === 'SUPPLIER';
  const sandbox = session.data?.paypalEnvironment === 'sandbox';
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-4 lg:px-6">
      <header>
        <h1 className="text-xl">Settings</h1>
        <p className="text-base text-ink-2">
          {session.data?.business.name}
          {sandbox ? ' · PayPal sandbox' : ''}
          {session.data?.demo ? ' · demo data' : ''}
        </p>
      </header>
      {owner ? (
        <>
          <OwnerPolicy />
          <OwnerConnection />
        </>
      ) : (
        <>
          <ClientPolicyCard />
          <VaultPanel />
        </>
      )}
      {sandbox ? (
        <p className="text-sm text-ink-3">
          This is PayPal’s sandbox: every invoice and payment is a real sandbox object, and no real
          money moves.
        </p>
      ) : null}
    </div>
  );
}
