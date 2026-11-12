import { type DealSummary, formatMoney } from '@terms/shared';
import clsx from 'clsx';
import { formatPercent } from '../../lib/display';
import { DealStatePill } from '../../ui/finance';

export interface DealListProps {
  deals: readonly DealSummary[];
  selectedId: string | null;
  onSelect: (dealId: string) => void;
}

/** Every conversation, the ones that need the owner first. */
export function DealList({ deals, selectedId, onSelect }: DealListProps) {
  return (
    <nav aria-label="Negotiations" className="lg:w-72 lg:shrink-0">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {deals.map((deal) => {
          const terms = deal.agreedTerms ?? deal.currentTerms;
          const selected = deal.id === selectedId;
          return (
            <li key={deal.id} className="min-w-56 lg:min-w-0">
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                onClick={() => {
                  onSelect(deal.id);
                }}
                className={clsx(
                  'w-full space-y-1 rounded-lg border bg-surface p-3 text-left transition-colors',
                  selected ? 'border-ink' : 'border-rule hover:border-rule-strong',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{deal.client.name}</span>
                  <DealStatePill state={deal.state} />
                </span>
                <span className="figures block text-sm text-ink-2">
                  {terms
                    ? `${formatMoney(terms.amountEarly)} at ${formatPercent(terms.discountPct)}`
                    : 'No terms yet'}
                </span>
                <span className="block text-xs text-ink-3">
                  Invoice {deal.invoiceNumber}
                  {deal.round > 0 ? ` · Round ${deal.round}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
