import { type BusinessSummary } from '@terms/shared';
import { Bot, Building2, UserRound } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonRows } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { useBusinesses, useSwitchSession } from './session';

function describe(business: BusinessSummary): string {
  if (business.role === 'SUPPLIER') return 'The owner. States the goal and approves the plan.';
  return business.hasAgent
    ? 'A client with its own agent and payment policy.'
    : 'A client without an agent. Gets an offer page or a reminder.';
}

function BusinessButton({
  business,
  pending,
  onChoose,
}: {
  business: BusinessSummary;
  pending: boolean;
  onChoose: () => void;
}) {
  const Icon = business.role === 'SUPPLIER' ? Building2 : business.hasAgent ? Bot : UserRound;
  return (
    <li>
      <button
        type="button"
        onClick={onChoose}
        disabled={pending}
        className="flex w-full items-start gap-3 rounded-lg border border-rule bg-surface p-4 text-left transition-colors hover:border-rule-strong hover:bg-paper disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <span className="min-w-0">
          <span className="block font-medium text-ink">{business.name}</span>
          <span className="block text-sm text-ink-2">{describe(business)}</span>
          {business.paypalEmail ? (
            <span className="mt-1 block font-mono text-xs break-all text-ink-3">
              {business.paypalEmail}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** Shown when there is no session: pick which business to act as in the demo. */
export function SessionPicker() {
  const businesses = useBusinesses();
  const switchSession = useSwitchSession();
  const { toastError } = useToast();

  const choose = (businessId: string) => {
    switchSession.mutate(businessId, {
      onError: (error) => {
        toastError('Could not start the session', error);
      },
    });
  };

  const group = (title: string, items: readonly BusinessSummary[]) =>
    items.length === 0 ? null : (
      <section>
        <h2 className="mb-2 text-md">{title}</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((business) => (
            <BusinessButton
              key={business.id}
              business={business}
              pending={switchSession.isPending}
              onChoose={() => {
                choose(business.id);
              }}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-xl">Who are you in this demo?</h1>
        <p className="text-md text-ink-2">
          Terms has two sides. Pick the business you want to act as. You can switch at any time.
        </p>
      </div>
      {businesses.isPending ? (
        <SkeletonRows rows={3} columns={2} label="Loading businesses" />
      ) : null}
      {businesses.isError ? (
        <ErrorState
          title="Could not load the demo businesses"
          error={businesses.error}
          onRetry={() => void businesses.refetch()}
          retrying={businesses.isFetching}
        />
      ) : null}
      {businesses.data?.length === 0 ? (
        <EmptyState title="No businesses yet">Run the demo seed to create them.</EmptyState>
      ) : null}
      {businesses.data ? (
        <>
          {group(
            'Owner',
            businesses.data.filter((b) => b.role === 'SUPPLIER'),
          )}
          {group(
            'Clients',
            businesses.data.filter((b) => b.role === 'CLIENT'),
          )}
        </>
      ) : null}
    </div>
  );
}
