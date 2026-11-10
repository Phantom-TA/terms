import { type DealDetail, formatMoney, isFinal } from '@terms/shared';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { type ReactNode } from 'react';
import { formatAnnualRate, formatPercent } from '../../lib/display';
import { ErrorState } from '../../ui/ErrorState';
import { DealStatePill, Money } from '../../ui/finance';
import { PendingNotice } from '../../ui/PendingNotice';
import { SkeletonRows } from '../../ui/Skeleton';
import { useDeal } from '../workbench/queries';
import { ApprovalCard } from '../approvals/ApprovalCard';
import { isSupplierMessage, MessageCard } from './MessageCard';
import { closingReason } from './closingReason';
import { SettlementSteps } from './SettlementSteps';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="figures text-base text-ink">{children}</dd>
    </div>
  );
}

/** What to call the terms. A deal that closed without agreement has nothing on the table. */
function termsLabel(deal: DealDetail): string {
  if (deal.countsAsCommitted) return 'Agreed';
  return isFinal(deal.state) ? 'Last terms' : 'On the table';
}

function DealHeader({ deal }: { deal: DealDetail }) {
  const reason = closingReason(deal);
  const terms = deal.agreedTerms ?? deal.currentTerms;
  const closedWithoutCash = isFinal(deal.state) && !deal.countsAsCommitted;
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl">{deal.client.name}</h2>
        <DealStatePill state={deal.state} />
        <span className="text-sm text-ink-3">Invoice {deal.invoiceNumber}</span>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {terms ? (
          <Fact label={termsLabel(deal)}>
            {formatMoney(terms.amountEarly)} at {formatPercent(terms.discountPct)}
          </Fact>
        ) : null}
        {deal.impliedAnnualRate && !closedWithoutCash ? (
          <Fact label="Client’s return">{formatAnnualRate(deal.impliedAnnualRate)}</Fact>
        ) : null}
        {closedWithoutCash ? null : (
          <>
            <Fact label="Cost to you">
              <Money value={deal.cost} />
            </Fact>
            <Fact label={deal.countsAsCommitted ? 'Committed' : 'If agreed'}>
              <Money value={deal.committedIfAgreed} committed={deal.countsAsCommitted} />
            </Fact>
          </>
        )}
      </dl>
      {reason ? <p className="text-base text-ink-2">{reason}</p> : null}
    </header>
  );
}

function Lane({ name, supplier }: { name: string; supplier: boolean }) {
  return (
    <p
      className={clsx(
        'rounded-sm px-3 py-1 text-sm font-medium',
        supplier ? 'bg-supplier-soft text-supplier' : 'bg-client-soft text-client',
      )}
    >
      {name}
    </p>
  );
}

/** What is happening with the money. PAID comes only from PayPal, through the server. */
function PaymentStatus({ deal }: { deal: DealDetail }) {
  if (deal.state === 'PAID' || deal.state === 'PARTIALLY_PAID') {
    return (
      <p className="flex items-center gap-2 rounded-md border border-committed bg-committed-soft px-3 py-2 text-base text-committed-strong">
        <Check aria-hidden className="size-4" />
        {deal.state === 'PAID' ? 'Paid. Confirmed by PayPal.' : 'Partly paid. Confirmed by PayPal.'}
      </p>
    );
  }
  if (deal.state !== 'AWAITING_PAYMENT') return null;
  // How the client pays is its own business (its approvals are not shown to the owner).
  return (
    <PendingNotice
      detail={`${deal.client.name} pays through PayPal. This updates when the verified webhook arrives.`}
    />
  );
}

export function Conversation({
  dealId,
  supplierName,
  onDecide,
}: {
  dealId: string;
  supplierName: string;
  onDecide: () => void;
}) {
  const query = useDeal(dealId);

  if (query.isPending)
    return <SkeletonRows rows={4} columns={2} label="Loading the conversation" />;
  if (!query.data) {
    return (
      <ErrorState
        title="Couldn’t load this conversation"
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const deal = query.data;
  const ownerApprovals = deal.approvals.filter(
    (a) => a.requestedFrom === 'OWNER' && a.decision === 'PENDING',
  );
  const last = deal.messages.at(-1);

  return (
    <div className="min-w-0 flex-1 space-y-4">
      <DealHeader deal={deal} />
      <PaymentStatus deal={deal} />

      {/* First, so what needs the owner is in view without scrolling. */}
      {ownerApprovals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} onDecide={onDecide} />
      ))}

      <div className="hidden gap-3 md:grid md:grid-cols-2">
        <Lane name={`${supplierName}’s agent`} supplier />
        <Lane name={`${deal.client.name}’s side`} supplier={false} />
      </div>

      {deal.messages.length === 0 ? (
        <p className="text-base text-ink-3">Nothing has been said yet.</p>
      ) : (
        <div role="log" aria-label={`Conversation with ${deal.client.name}`}>
          <ol className="space-y-3">
            {deal.messages.map((message) => (
              <li key={message.id} className="gap-3 md:grid md:grid-cols-2">
                <div className={clsx(!isSupplierMessage(message) && 'md:col-start-2')}>
                  <MessageCard
                    message={message}
                    clientName={deal.client.name}
                    supplierName={supplierName}
                    latest={message.id === last?.id && !isFinal(deal.state)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <SettlementSteps dealId={deal.id} />
    </div>
  );
}
