import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '../../app/session';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { Conversation } from './Conversation';
import { DealList } from './DealList';
import { negotiableDeals, nextAutoDealId, selectedDealId, sortDeals } from './deals';
import { useDeals } from './queries';
import { useNegotiationLive } from './useNegotiationLive';

function Heading() {
  return (
    <header className="px-4 pt-4 lg:px-6">
      <h1 className="text-xl">Negotiation Room</h1>
      <p className="text-base text-ink-2">
        Your agent and each client’s agent, working within both sides’ policies. Limits are checked
        in code on every move.
      </p>
    </header>
  );
}

export function Component() {
  useNegotiationLive();
  const session = useSession();
  const query = useDeals();
  const [params, setParams] = useSearchParams();

  const deals = useMemo(
    () => (query.data ? sortDeals(negotiableDeals(query.data.deals)) : []),
    [query.data],
  );
  // Held across renders, so a live update can't swap the conversation being read.
  const [autoId, setAutoId] = useState<string | null>(null);
  const nextAuto = nextAutoDealId(deals, autoId);
  if (nextAuto !== autoId) setAutoId(nextAuto);
  const selected = selectedDealId(deals, params.get('deal'), nextAuto);

  if (query.isPending) {
    return (
      <div>
        <Heading />
        <div className="p-4 lg:p-6">
          <SkeletonRows rows={4} columns={3} label="Loading the negotiations" />
        </div>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorState
          headingLevel="h1"
          title="Couldn’t load the negotiations"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </div>
    );
  }

  return (
    <div>
      <Heading />
      <div className="p-4 lg:p-6">
        {selected === null ? (
          <EmptyState
            title={query.data.deals.length > 0 ? 'Nothing to negotiate' : 'No negotiations yet'}
            action={
              <Link to="/workbench" className="font-medium text-ink underline underline-offset-2">
                Go to the Workbench
              </Link>
            }
          >
            {query.data.deals.length > 0
              ? 'This plan only sends reminders, so no one is negotiating.'
              : 'Approve a plan, and each negotiation appears here as it happens.'}
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
            <DealList
              deals={deals}
              selectedId={selected}
              onSelect={(deal) => {
                setParams({ deal }, { replace: true });
              }}
            />
            <Conversation
              key={selected}
              dealId={selected}
              supplierName={session.data?.business.name ?? 'The owner'}
              // Stay on this conversation to see the result, even if it sorts lower afterwards.
              onDecide={() => {
                setParams({ deal: selected }, { replace: true });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
