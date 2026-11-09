import { type Goal, formatMoney, type Plan } from '@terms/shared';
import clsx from 'clsx';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { formatDateTime } from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ApprovePlanDialog } from './ApprovePlanDialog';

function Stat({
  label,
  value,
  hint,
  committed = false,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  committed?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd
        className={clsx(
          'figures font-display text-xl leading-tight',
          committed ? 'text-committed-strong' : 'text-ink',
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="text-sm text-ink-3">{hint}</dd> : null}
    </div>
  );
}

export interface TopRailProps {
  goal: Goal;
  plan: Plan;
}

/**
 * The numbers that matter, all from the server: the gap, what is committed (only agreed or paid
 * cash), what is merely planned, what it costs, and the ceiling. Approving lives here too.
 */
export function TopRail({ goal, plan }: TopRailProps) {
  const [approving, setApproving] = useState(false);
  const { summary } = plan;
  const money = (value: string) => formatMoney(value);

  return (
    <section
      aria-label="Plan summary"
      className="border-b border-rule bg-surface px-4 py-4 lg:px-6"
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          <Stat
            label="Gap to close"
            value={money(summary.gap)}
            hint={`Target ${money(summary.target)} with ${money(summary.buffer)} buffer`}
          />
          <Stat
            label="Committed"
            value={money(summary.committed)}
            committed
            hint={summary.goalMet ? 'Goal met' : `${money(summary.remaining)} still to commit`}
          />
          <Stat
            label="Planned, not committed"
            value={money(summary.plannedCommitted)}
            hint="If every offer is accepted"
          />
          <Stat
            label="Cost so far"
            value={money(summary.costSoFar)}
            hint={`${money(summary.plannedCost)} planned · ceiling ${money(summary.costCeiling)}`}
          />
          <Stat
            label="Best effort"
            value={money(summary.bestEffort)}
            hint="Reminders. Not counted"
          />
        </dl>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {plan.status === 'DRAFT' ? (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setApproving(true);
                }}
              >
                Approve plan
              </Button>
              <p className="text-sm text-ink-3">Nothing is sent until you approve.</p>
            </>
          ) : (
            <PlanStatus plan={plan} />
          )}
        </div>
      </div>

      {summary.shortfall && plan.status === 'DRAFT' ? (
        <p
          role="note"
          className="mt-3 rounded-md border border-warn bg-warn-soft px-3 py-2 text-base text-warn"
        >
          Within your limits this plan can’t reach {money(summary.target)}. It would commit{' '}
          {money(summary.plannedCommitted)}. Raise your maximum discount or ceiling to close the
          gap.
        </p>
      ) : null}
      {summary.goalMet ? (
        <p
          role="note"
          className="mt-3 flex items-center gap-2 rounded-md border border-committed bg-committed-soft px-3 py-2 text-base text-committed-strong"
        >
          <CheckCircle2 aria-hidden className="size-4" />
          Goal met for {money(goal.amount)}. Offers that are no longer needed have been withdrawn.
        </p>
      ) : null}

      {plan.status === 'DRAFT' ? (
        <ApprovePlanDialog plan={plan} open={approving} onOpenChange={setApproving} />
      ) : null}
    </section>
  );
}

function PlanStatus({ plan }: { plan: Plan }) {
  if (plan.status === 'MET') return <Badge tone="committed">Goal met</Badge>;
  if (plan.status === 'CANCELLED') return <Badge>Cancelled</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge tone="info">Plan approved</Badge>
      {plan.approvedAt ? (
        <p className="text-sm text-ink-3">{formatDateTime(plan.approvedAt)}</p>
      ) : null}
    </div>
  );
}
