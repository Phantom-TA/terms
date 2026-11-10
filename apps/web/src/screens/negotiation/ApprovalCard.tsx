import { type ApprovalView, formatMoney, toCents } from '@terms/shared';
import { useState } from 'react';
import { ApiError } from '../../api/errors';
import { formatDateTime, formatPercent } from '../../lib/display';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { useToast } from '../../ui/Toast';
import { useDecideApproval } from './queries';

type Decision = 'APPROVED' | 'REJECTED';

const isConflict = (error: unknown) => error instanceof ApiError && error.code === 'CONFLICT';

/**
 * A counter that needs the owner: what approving would do and what it costs. It counts as decided
 * only after the server says so.
 */
export function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ApprovalView;
  /** Called as the owner decides, before the server answers. */
  onDecide?: () => void;
}) {
  const decide = useDecideApproval();
  const { toast } = useToast();
  const [chosen, setChosen] = useState<Decision | null>(null);
  const { costImpact, terms } = approval;
  const over =
    costImpact && toCents(costImpact.overCeilingBy) > 0n ? costImpact.overCeilingBy : null;

  const send = async (decision: Decision) => {
    setChosen(decision);
    onDecide?.();
    try {
      // Awaited: the card leaves the page once the server's answer arrives.
      await decide.mutateAsync({ approvalId: approval.id, dealId: approval.dealId, decision });
    } catch (error) {
      // The card disappears once the refreshed deal says it was decided, so say so somewhere.
      if (isConflict(error)) {
        toast({ tone: 'info', title: 'Already decided', description: approval.title });
      }
      return; // Anything else is shown on the card from the mutation's error.
    }
    toast({
      tone: 'success',
      title: decision === 'APPROVED' ? 'Approved' : 'Rejected',
      description: approval.title,
    });
  };

  return (
    <section
      aria-label={`Needs your approval: ${approval.title}`}
      className="animate-enter space-y-3 rounded-lg border border-warn bg-warn-soft p-4"
    >
      <div>
        <p className="text-sm font-medium text-warn">Needs you</p>
        <h3 className="text-lg">{approval.title}</h3>
        <p className="text-base text-ink">{approval.summary}</p>
      </div>

      {costImpact ? (
        <dl className="figures flex flex-wrap gap-x-8 gap-y-2 text-base">
          <div>
            <dt className="text-sm text-ink-2">Plan cost</dt>
            <dd>
              {formatMoney(costImpact.planCostBefore)} → {formatMoney(costImpact.planCostAfter)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-2">Your ceiling</dt>
            <dd>{formatMoney(costImpact.ceiling)}</dd>
          </div>
          {over ? (
            <div>
              <dt className="text-sm text-ink-2">Over your ceiling by</dt>
              <dd className="font-medium text-warn">+{formatMoney(over)}</dd>
            </div>
          ) : null}
          {terms ? (
            <div>
              <dt className="text-sm text-ink-2">Would offer</dt>
              <dd>
                {formatMoney(terms.amountEarly)} at {formatPercent(terms.discountPct)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {decide.isError ? (
        <ErrorState
          headingLevel="h3"
          title="Your decision was not recorded"
          error={decide.error}
          {...(chosen ? { onRetry: () => void send(chosen), retrying: decide.isPending } : {})}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void send('APPROVED')}
          loading={decide.isPending && chosen === 'APPROVED'}
          disabled={decide.isPending}
        >
          Approve
        </Button>
        <Button
          variant="danger"
          onClick={() => void send('REJECTED')}
          loading={decide.isPending && chosen === 'REJECTED'}
          disabled={decide.isPending}
        >
          Reject
        </Button>
        {approval.expiresAt ? (
          <span className="text-sm text-ink-2">Decide by {formatDateTime(approval.expiresAt)}</span>
        ) : null}
      </div>
    </section>
  );
}
