import { type ClientOffer, type OfferRecommendation } from '@terms/shared';
import { type ColDef } from 'ag-grid-community';
import { type CustomCellRendererProps } from 'ag-grid-react';
import { TermsGrid } from '../../grid/TermsGrid';
import {
  formatAnnualRate,
  formatDate,
  formatDateTime,
  formatPercent,
  type Tone,
} from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { ErrorState } from '../../ui/ErrorState';
import { DealStatePill, MoneyWithDiscount, PolicyBadges } from '../../ui/finance';
import { Skeleton } from '../../ui/Skeleton';
import { MessageCard } from '../negotiation/MessageCard';
import { useDeal } from '../workbench/queries';

type Props = CustomCellRendererProps<ClientOffer>;

const RECOMMENDATION: Readonly<Record<OfferRecommendation, { label: string; tone: Tone }>> = {
  ACCEPT: { label: 'Accept', tone: 'info' },
  COUNTER: { label: 'Counter', tone: 'warn' },
  DECLINE: { label: 'Decline', tone: 'neutral' },
  NEEDS_HUMAN: { label: 'Needs a person', tone: 'warn' },
};

function PayCell({ data }: Props) {
  return data ? (
    <MoneyWithDiscount original={data.terms.amountEarly} discounted={data.payNow} />
  ) : null;
}
function RecommendationCell({ data }: Props) {
  if (!data) return null;
  const { label, tone } = RECOMMENDATION[data.recommendation];
  return <Badge tone={tone}>{label}</Badge>;
}
function ChecksCell({ data }: Props) {
  const flagged = data?.policyChecks.filter((c) => c.result !== 'pass') ?? [];
  if (!data) return null;
  return flagged.length > 0 ? (
    <PolicyBadges checks={flagged} />
  ) : (
    <Badge>All {data.policyChecks.length} passed</Badge>
  );
}
function StateCell({ data }: Props) {
  return data ? <DealStatePill state={data.state} /> : null;
}

/** The conversation behind an offer, as the client sees it. */
function OfferDetail({ data }: Props) {
  const deal = useDeal(data?.dealId ?? null);
  if (!data) return null;
  return (
    <div role="gridcell" className="space-y-3 bg-paper px-6 py-4 whitespace-normal">
      <h2 className="text-md">What has been said</h2>
      {deal.isPending ? <Skeleton className="w-2/3" /> : null}
      {deal.isError ? (
        <ErrorState
          title="Couldn’t load the conversation"
          error={deal.error}
          onRetry={() => void deal.refetch()}
          retrying={deal.isFetching}
        />
      ) : null}
      {deal.data ? (
        <ol className="grid gap-3 md:grid-cols-2">
          {deal.data.messages.map((message) => (
            <li key={message.id}>
              <MessageCard
                message={message}
                clientName={deal.data.client.name}
                supplierName={data.supplier.name}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const COLUMNS: ColDef<ClientOffer>[] = [
  {
    colId: 'supplier',
    headerName: 'Supplier',
    width: 170,
    cellRenderer: 'agGroupCellRenderer',
    valueGetter: (p) => p.data?.supplier.name,
  },
  {
    colId: 'invoice',
    headerName: 'Invoice',
    width: 90,
    valueGetter: (p) => p.data?.invoice.number,
  },
  {
    colId: 'pay',
    headerName: 'You pay now',
    width: 190,
    cellRenderer: PayCell,
    valueGetter: (p) => p.data?.payNow,
  },
  {
    colId: 'discount',
    headerName: 'Discount',
    width: 96,
    valueGetter: (p) => (p.data ? formatPercent(p.data.terms.discountPct) : ''),
  },
  { colId: 'early', headerName: 'Days early', width: 104, valueGetter: (p) => p.data?.daysEarly },
  {
    colId: 'rate',
    headerName: 'Your return',
    width: 136,
    valueGetter: (p) => (p.data ? formatAnnualRate(p.data.impliedAnnualRate) : ''),
  },
  {
    colId: 'recommendation',
    headerName: 'Your agent says',
    width: 150,
    cellRenderer: RecommendationCell,
    valueGetter: (p) => p.data?.recommendation,
  },
  {
    colId: 'checks',
    headerName: 'Your policy',
    width: 220,
    cellRenderer: ChecksCell,
    valueGetter: (p) => p.data?.policyChecks.length,
  },
  {
    colId: 'state',
    headerName: 'State',
    width: 170,
    cellRenderer: StateCell,
    valueGetter: (p) => p.data?.state,
  },
  {
    colId: 'due',
    headerName: 'Due',
    width: 120,
    valueGetter: (p) => (p.data ? formatDate(p.data.invoice.dueDate) : ''),
  },
  {
    colId: 'expires',
    headerName: 'Open until',
    width: 150,
    valueGetter: (p) => (p.data?.expiresAt ? formatDateTime(p.data.expiresAt) : ''),
  },
];

const DEFAULT_COL_DEF = { sortable: false, resizable: true, suppressHeaderMenuButton: true };
const getRowId = (p: { data: ClientOffer }) => p.data.dealId;
const isRowMaster = () => true;

/** Offers in the server's order: highest annualised return first. */
export function OffersGrid({ offers }: { offers: readonly ClientOffer[] }) {
  return (
    <div data-testid="offers-grid" className="w-full">
      <TermsGrid<ClientOffer>
        rowData={offers as ClientOffer[]}
        columnDefs={COLUMNS}
        defaultColDef={DEFAULT_COL_DEF}
        getRowId={getRowId}
        domLayout="autoHeight"
        masterDetail
        isRowMaster={isRowMaster}
        detailCellRenderer={OfferDetail}
        detailRowAutoHeight
        suppressColumnVirtualisation
      />
    </div>
  );
}
