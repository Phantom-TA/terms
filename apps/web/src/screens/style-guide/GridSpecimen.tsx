import { type ColDef } from 'ag-grid-community';
import {
  ActionCell,
  CommittedMoneyCell,
  DealStateCell,
  DiscountedMoneyCell,
  PolicyBadgesCell,
} from '../../grid/renderers';
import { TermsGrid } from '../../grid/TermsGrid';
import { type DealState, type ActionType, type PolicyResult, type PolicyRule } from '@terms/shared';

interface SampleRow {
  client: string;
  invoice: string;
  amount: { original: string; discounted: string } | string;
  action: ActionType;
  state: DealState | null;
  committed: string | null;
  policy: { rule: PolicyRule; result: PolicyResult; detail: string }[];
}

const ROWS: SampleRow[] = [
  {
    client: 'Juniper Labs',
    invoice: '#1041',
    amount: { original: '5000.00', discounted: '4960.00' },
    action: 'NEGOTIATE',
    state: 'AWAITING_PAYMENT',
    committed: '4960.00',
    policy: [{ rule: 'maxDiscount', result: 'pass', detail: 'Within the maximum' }],
  },
  {
    client: 'Harbor & Co',
    invoice: '#1043',
    amount: { original: '1750.00', discounted: '1729.00' },
    action: 'NEGOTIATE',
    state: 'NEEDS_OWNER',
    committed: null,
    policy: [{ rule: 'costCeiling', result: 'needs_approval', detail: '$1 over the ceiling' }],
  },
  {
    client: 'Oak Street Bakery',
    invoice: '#1038',
    amount: '1800.00',
    action: 'REMINDER',
    state: 'SENT',
    committed: null,
    policy: [],
  },
  {
    client: 'Pinecrest Dental',
    invoice: '#1039',
    amount: '2000.00',
    action: 'NONE',
    state: null,
    committed: null,
    policy: [{ rule: 'doNotContact', result: 'blocked', detail: 'On the do-not-contact list' }],
  },
];

const COLUMNS: ColDef<SampleRow>[] = [
  { field: 'client', flex: 1, minWidth: 130 },
  { field: 'invoice', width: 84 },
  { field: 'amount', cellDataType: false, cellRenderer: DiscountedMoneyCell, width: 176 },
  { field: 'action', cellRenderer: ActionCell, width: 110 },
  { field: 'state', headerName: 'Deal state', cellRenderer: DealStateCell, width: 150 },
  { field: 'committed', cellRenderer: CommittedMoneyCell, width: 104 },
  { field: 'policy', cellDataType: false, cellRenderer: PolicyBadgesCell, flex: 1, minWidth: 210 },
];

const DEFAULT_COLUMN: ColDef<SampleRow> = { suppressHeaderMenuButton: true };

/** Shows the theme and renderers in a real grid. Sample data. */
export function GridSpecimen() {
  return (
    <div data-testid="grid-specimen">
      <TermsGrid<SampleRow>
        rowData={ROWS}
        columnDefs={COLUMNS}
        defaultColDef={DEFAULT_COLUMN}
        domLayout="autoHeight"
        getRowId={(params) => params.data.invoice}
      />
    </div>
  );
}
