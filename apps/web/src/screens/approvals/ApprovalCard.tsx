import { type ApprovalView, formatMoney, toCents } from '@terms/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/errors';
import { browser } from '../../lib/browser';
import { formatDateTime, formatPercent } from '../../lib/display';
import { Button } from '../../ui/Button';
import { ErrorState } from '../../ui/ErrorState';
import { useToast } from '../../ui/Toast';
import { useDecideApproval } from './queries';

type Decision = 'APPROVED' | 'REJECTED';

const isConflict = (error: unknown) => error instanceof ApiError && error.code === 'CONFLICT';

export interface ApprovalCardProps {
  approval: ApprovalView;
  /** Called as the person decides, before the server answers. */
  onDecide?: () => void;
  /** Where the thing being decided can be seen in full. */
  context?: { to: string; label: string };
}

/**
 * Something that needs a person: what approving would do and what it costs. It counts as decided
 * only after the server says so. A client's payment then counts as paid only when PayPal confirms it.
 */
export function ApprovalCard({ approval, onDecide, context }: ApprovalCardProps) {
  const decide = useDecideApproval();
  const { toast } = useToast();
  const [chosen, setChosen] = useState<Decision | null>(null);
  const { costImpact, terms } = approval;
  const payment = approval.type === 'CLIENT_PAYMENT';
  const over =
    costImpact && toCents(costImpact.overCeilingBy) > 0n ? costImpact.overCeilingBy : null;

  const send = async (decision: Decision) => {
    setChosen(decision);
    onDecide?.();
    // A payment may be paid on PayPal's invoice page, in a new tab. Open it now, at the click.
    const tab = payment && decision === 'APPROVED' ? browser.openTab('Opening PayPal…') : null;
    let result;
    try {
      // Awaited: the card leaves the page once the server's answer arrives.
      result = await decide.mutateAsync({
        approvalId: approval.id,
        dealId: approval.dealId,
        decision,
      });
    } catch (error) {
      tab?.close();
      // The card disappears once the refreshed data says it was decided, so say so somewhere.
      if (isConflict(error)) {
        toast({ tone: 'info', title: 'Already decided', description: approval.title });
      }
      return; // Anything else is shown on the card from the mutation's error.
    }
    if (!payment || decision === 'REJECTED') {
      tab?.close();
      toast({
        tone: 'success',
        title: decision === 'APPROVED' ? 'Approved' : 'Rejected',
        description: approval.title,
      });
      return;
    }
    // Approved, but nothing is paid until PayPal confirms it; the desk shows it waiting.
    if (result.paypalApprovalUrl && tab) {
      tab.go(result.paypalApprovalUrl);
      toast({
        tone: 'info',
        title: 'PayPal invoice opened in a new tab',
        description: 'Pay it there. This page updates when PayPal confirms the payment.',
      });
    } else if (result.paypalApprovalUrl) {
      toast({
        tone: 'info',
        title: 'Pay the invoice on PayPal',
        description: 'Your browser blocked the new tab. Open the invoice from the Payables Desk.',
      });
    } else {
      tab?.close();
      toast({
        tone: 'info',
        title: 'Approved. Paying from your saved PayPal method',
        description: 'This page updates when PayPal confirms the payment.',
      });
    }
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

      {costImpact || payment || terms ? (
        <dl className="figures flex flex-wrap gap-x-8 gap-y-2 text-base">
          {costImpact ? (
            <>
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
            </>
          ) : null}
          {over ? (
            <div>
              <dt className="text-sm text-ink-2">Over your ceiling by</dt>
              <dd className="font-medium text-warn">+{formatMoney(over)}</dd>
            </div>
          ) : null}
          {payment && approval.paymentAmount ? (
            <div>
              <dt className="text-sm text-ink-2">Payment</dt>
              <dd>{formatMoney(approval.paymentAmount)}</dd>
            </div>
          ) : null}
          {terms ? (
            <div>
              <dt className="text-sm text-ink-2">{payment ? 'Terms' : 'Would offer'}</dt>
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
        {approval.type === 'PLAN' ? (
          // A plan is approved with its cost ceiling, which is set on the Workbench.
          <Link
            to="/workbench"
            className="inline-flex h-9 items-center rounded-md bg-ink px-3.5 font-medium text-on-ink hover:bg-ink-2"
          >
            Review on the Workbench
          </Link>
        ) : (
          <>
            <Button
              variant="primary"
              onClick={() => void send('APPROVED')}
              loading={decide.isPending && chosen === 'APPROVED'}
              disabled={decide.isPending}
            >
              {payment ? 'Approve payment' : 'Approve'}
            </Button>
            <Button
              variant="danger"
              onClick={() => void send('REJECTED')}
              loading={decide.isPending && chosen === 'REJECTED'}
              disabled={decide.isPending}
            >
              Reject
            </Button>
          </>
        )}
        {approval.expiresAt ? (
          <span className="text-sm text-ink-2">Decide by {formatDateTime(approval.expiresAt)}</span>
        ) : null}
        {context ? (
          <Link
            to={context.to}
            className="text-sm font-medium text-ink underline underline-offset-2"
          >
            {context.label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
