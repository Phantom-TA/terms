import { type BusinessRef } from '@terms/shared';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useBusinesses, useSession } from '../../app/session';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { useConnection } from '../connect/queries';
import { VaultPanel } from '../payables/VaultPanel';
import { useInvoices, useSupplierPolicy } from '../workbench/queries';
import { ClientPolicyForm } from './ClientPolicyForm';
import { useClientPolicy } from './queries';
import { SupplierPolicyForm } from './SupplierPolicyForm';

const LINK = 'font-medium text-ink underline underline-offset-2';

function OwnerPolicy() {
  const policy = useSupplierPolicy();
  const invoices = useInvoices();
  const clients = useMemo<BusinessRef[]>(
    () => [...new Map((invoices.data?.rows ?? []).map((r) => [r.client.id, r.client])).values()],
    [invoices.data],
  );
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

function ClientPolicy() {
  const policy = useClientPolicy();
  const businesses = useBusinesses();
  const suppliers = (businesses.data ?? []).filter((b) => b.role === 'SUPPLIER');
  return (
    <Card title="Your agent’s policy">
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
        <ClientPolicyForm key={policy.data.updatedAt} policy={policy.data} suppliers={suppliers} />
      ) : null}
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
          <ClientPolicy />
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
