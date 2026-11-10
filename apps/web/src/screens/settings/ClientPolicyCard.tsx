import { useBusinesses } from '../../app/session';
import { Card } from '../../ui/Card';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { ClientPolicyForm } from './ClientPolicyForm';
import { useClientPolicy } from './queries';

/** A client's rules for its agent, loaded and saved through the server. */
export function ClientPolicyCard() {
  const policy = useClientPolicy();
  const businesses = useBusinesses();
  const suppliers = (businesses.data ?? []).filter((b) => b.role === 'SUPPLIER');
  return (
    <Card
      title="Your agent’s policy"
      description="Checked in code on every offer before your agent answers."
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
        <ClientPolicyForm key={policy.data.updatedAt} policy={policy.data} suppliers={suppliers} />
      ) : null}
    </Card>
  );
}
