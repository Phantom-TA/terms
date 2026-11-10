import { type ApprovalDecision, type ApprovalView } from '@terms/shared';
import { useSession } from '../../app/session';
import { formatDateTime, type Tone } from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { ApprovalCard } from './ApprovalCard';
import { pendingApprovals, useApprovals } from './queries';

const DECISION: Readonly<Record<ApprovalDecision, { label: string; tone: Tone }>> = {
  PENDING: { label: 'Waiting', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'info' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
};

function contextFor(approval: ApprovalView, owner: boolean) {
  if (!approval.dealId) return undefined;
  return owner
    ? {
        to: `/negotiation?deal=${encodeURIComponent(approval.dealId)}`,
        label: 'See the negotiation',
      }
    : { to: '/payables', label: 'See it on the Payables Desk' };
}

function History({ approvals }: { approvals: readonly ApprovalView[] }) {
  if (approvals.length === 0) return <p className="text-base text-ink-3">Nothing decided yet.</p>;
  return (
    <ul className="divide-y divide-rule rounded-lg border border-rule bg-surface">
      {approvals.map((approval) => {
        const decision = DECISION[approval.decision];
        return (
          <li key={approval.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
            <Badge tone={decision.tone}>{decision.label}</Badge>
            <span className="min-w-0 flex-1 text-base text-ink">{approval.title}</span>
            <span className="text-sm text-ink-3">
              {approval.decidedAt ? formatDateTime(approval.decidedAt) : ''}
            </span>
            {approval.decisionNote ? (
              <p className="w-full text-sm text-ink-2">“{approval.decisionNote}”</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Everything waiting on this business's people, and what they decided before. */
export function Component() {
  const session = useSession();
  const query = useApprovals();
  const owner = session.data?.business.role === 'SUPPLIER';

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-4 lg:px-6">
      <header>
        <h1 className="text-xl">Approvals</h1>
        <p className="text-base text-ink-2">
          {owner
            ? 'Anything over your plan or your ceiling comes back to you here.'
            : 'Payments above your agent’s limit wait here for a person to approve them in PayPal.'}
        </p>
      </header>

      {query.isPending ? <SkeletonRows rows={3} columns={3} label="Loading approvals" /> : null}
      {query.isError ? (
        <ErrorState
          title="Couldn’t load the approvals"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : null}

      {query.data ? (
        <>
          <section aria-labelledby="waiting-heading" className="space-y-3">
            <h2 id="waiting-heading" className="text-lg">
              Waiting for you
            </h2>
            {pendingApprovals(query.data).length === 0 ? (
              <EmptyState title="Nothing needs you">
                {owner
                  ? 'Counters inside your plan are handled by your agent.'
                  : 'Your agent pays within its limit on its own.'}
              </EmptyState>
            ) : (
              pendingApprovals(query.data).map((approval) => {
                const context = contextFor(approval, owner);
                return (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    {...(context ? { context } : {})}
                  />
                );
              })
            )}
          </section>
          <section aria-labelledby="decided-heading" className="space-y-3">
            <h2 id="decided-heading" className="text-lg">
              Decided
            </h2>
            <History approvals={query.data.filter((a) => a.decision !== 'PENDING')} />
          </section>
        </>
      ) : null}
    </div>
  );
}
