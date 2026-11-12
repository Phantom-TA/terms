import { type ClientOffer, formatMoney } from '@terms/shared';
import { lazy, Suspense, useState } from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { PendingNotice } from '../../ui/PendingNotice';
import { SkeletonRows } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';
import { ApprovalCard } from '../approvals/ApprovalCard';
import { pendingApprovals, useApprovals } from '../approvals/queries';
import { ClientPolicyCard } from '../settings/ClientPolicyCard';
import { useDeal } from '../workbench/queries';
import { type OfferStatus, useClientOffers, usePayablesLive } from './queries';
import { VaultPanel } from './VaultPanel';

const OffersGrid = lazy(() => import('./OffersGrid').then((m) => ({ default: m.OffersGrid })));

const TABS: readonly { status: OfferStatus; label: string }[] = [
  { status: 'OPEN', label: 'Open' },
  { status: 'CLOSED', label: 'Closed' },
  { status: 'ALL', label: 'All' },
];

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="figures font-display text-xl text-ink">{value}</dd>
      <dd className="text-sm text-ink-3">{hint}</dd>
    </div>
  );
}

/** The PayPal invoice for a payment approved without a saved method, if there is one. */
function InvoiceLink({ dealId }: { dealId: string }) {
  const deal = useDeal(dealId);
  const url = deal.data?.paypal.payerUrl;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-block text-sm font-medium text-ink underline underline-offset-2"
    >
      Open the PayPal invoice<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Approved payments, which count as paid only once PayPal confirms them. */
function WaitingForPayPal({ offers }: { offers: readonly ClientOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="paying-heading" className="space-y-3">
      <h2 id="paying-heading" className="text-lg">
        Being paid
      </h2>
      {offers.map((offer) => (
        <PendingNotice
          key={offer.dealId}
          detail={`${formatMoney(offer.payNow)} to ${offer.supplier.name} for invoice ${offer.invoice.number}. This updates when PayPal confirms the payment.`}
        >
          <InvoiceLink dealId={offer.dealId} />
        </PendingNotice>
      ))}
    </section>
  );
}

/** A client's view: offers from suppliers, ranked by what paying early earns, and its rules. */
export function Component() {
  const { toast } = useToast();
  usePayablesLive((deal) => {
    toast({
      tone: 'success',
      title: 'Payment confirmed by PayPal',
      description: `Invoice ${deal.invoiceNumber} is paid.`,
    });
  });
  const [status, setStatus] = useState<OfferStatus>('OPEN');
  const offers = useClientOffers(status);
  const open = useClientOffers('OPEN');
  const paying = (open.data?.offers ?? []).filter(
    (o) => o.state === 'AWAITING_PAYMENT' && o.pendingApprovalId === null,
  );
  const approvals = useApprovals();
  const waiting = approvals.data ? pendingApprovals(approvals.data) : [];

  return (
    <div className="space-y-6 px-4 py-4 lg:px-6">
      <header>
        <h1 className="text-xl">Payables Desk</h1>
        <p className="text-base text-ink-2">
          Suppliers’ offers to be paid early, ranked by what paying early earns you.
        </p>
      </header>

      {offers.data ? (
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Stat
            label="Cash available"
            value={formatMoney(offers.data.cashPosition.available)}
            hint="Your PayPal balance"
          />
          <Stat
            label="Buffer"
            value={formatMoney(offers.data.cashPosition.buffer)}
            hint="Never paid out early"
          />
          <Stat
            label="Can pay early"
            value={formatMoney(offers.data.cashPosition.spendableEarly)}
            hint="Above the buffer"
          />
        </dl>
      ) : null}

      {waiting.length > 0 ? (
        <section aria-labelledby="waiting-heading" className="space-y-3">
          <h2 id="waiting-heading" className="text-lg">
            Waiting for a person
          </h2>
          {waiting.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </section>
      ) : null}

      <WaitingForPayPal offers={paying} />

      <section aria-labelledby="offers-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="offers-heading" className="text-lg">
            Offers
          </h2>
          <div
            role="group"
            aria-label="Show offers"
            className="flex gap-1 rounded-md border border-rule bg-surface p-0.5"
          >
            {TABS.map((tab) => (
              <button
                key={tab.status}
                type="button"
                aria-pressed={status === tab.status}
                onClick={() => {
                  setStatus(tab.status);
                }}
                className={
                  status === tab.status
                    ? 'rounded-sm bg-ink px-3 py-1 text-sm text-on-ink'
                    : 'rounded-sm px-3 py-1 text-sm text-ink-2 hover:bg-sunken'
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {offers.isPending ? <SkeletonRows rows={3} columns={6} label="Loading offers" /> : null}
        {offers.isError && !offers.data ? (
          <ErrorState
            title="Couldn’t load your offers"
            error={offers.error}
            onRetry={() => void offers.refetch()}
            retrying={offers.isFetching}
          />
        ) : null}
        {offers.data?.offers.length === 0 ? (
          <EmptyState title={status === 'CLOSED' ? 'No closed offers' : 'No offers right now'}>
            {status === 'OPEN'
              ? 'When a supplier offers a discount for paying early, it appears here.'
              : 'Offers that end appear here.'}
          </EmptyState>
        ) : null}
        {offers.data && offers.data.offers.length > 0 ? (
          <Suspense fallback={<SkeletonRows rows={3} columns={6} label="Loading the grid" />}>
            <OffersGrid offers={offers.data.offers} />
          </Suspense>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ClientPolicyCard />
        <VaultPanel />
      </div>
    </div>
  );
}
