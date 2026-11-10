import { type AuditEntry } from '@terms/shared';
import { type ColDef } from 'ag-grid-community';
import { type CustomCellRendererProps } from 'ag-grid-react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { TermsGrid } from '../../grid/TermsGrid';
import { formatDateTime } from '../../lib/display';
import { ACTOR_LABEL, actionLabel } from '../../lib/labels';
import { Badge } from '../../ui/Badge';

type Props = CustomCellRendererProps<AuditEntry>;

function CallCell({ data }: Props) {
  return data?.paypalCall ? (
    <code className="rounded-sm border border-rule-strong bg-paper px-1.5 py-0.5 font-mono text-xs">
      {data.paypalCall}
    </code>
  ) : null;
}

function WebhookCell({ data }: Props) {
  if (data?.webhookVerified === true) {
    return <Badge icon={<ShieldCheck aria-hidden className="size-3" />}>Verified</Badge>;
  }
  if (data?.webhookVerified === false) {
    return (
      <Badge tone="danger" icon={<ShieldAlert aria-hidden className="size-3" />}>
        Rejected
      </Badge>
    );
  }
  return null;
}

function MonoCell({ value }: CustomCellRendererProps<AuditEntry, string | null>) {
  return value ? <span className="font-mono text-xs">{value}</span> : null;
}

const COLUMNS: ColDef<AuditEntry>[] = [
  {
    colId: 'at',
    headerName: 'When',
    width: 150,
    valueGetter: (p) => p.data?.at,
    valueFormatter: (p) => (typeof p.value === 'string' ? formatDateTime(p.value) : ''),
  },
  {
    colId: 'actor',
    headerName: 'Who',
    width: 140,
    valueGetter: (p) => (p.data ? ACTOR_LABEL[p.data.actor] : ''),
  },
  {
    colId: 'action',
    headerName: 'What',
    width: 180,
    valueGetter: (p) => (p.data ? actionLabel(p.data.action) : ''),
  },
  {
    colId: 'summary',
    headerName: 'Detail',
    flex: 1,
    minWidth: 280,
    wrapText: true,
    autoHeight: true,
    cellClass: 'terms-wrap',
    valueGetter: (p) => p.data?.summary,
  },
  {
    colId: 'paypalCall',
    headerName: 'PayPal call',
    width: 270,
    valueGetter: (p) => p.data?.paypalCall ?? null,
    cellRenderer: CallCell,
  },
  {
    colId: 'webhook',
    headerName: 'Webhook',
    width: 120,
    valueGetter: (p) => p.data?.webhookVerified ?? null,
    cellRenderer: WebhookCell,
  },
  {
    colId: 'debugId',
    headerName: 'PayPal debug ID',
    width: 170,
    valueGetter: (p) => p.data?.paypalDebugId ?? null,
    cellRenderer: MonoCell,
  },
  {
    colId: 'requestId',
    headerName: 'Request ID',
    width: 170,
    valueGetter: (p) => p.data?.paypalRequestId ?? null,
    cellRenderer: MonoCell,
  },
  {
    colId: 'subject',
    headerName: 'About',
    width: 190,
    valueGetter: (p) =>
      p.data ? `${p.data.subjectType.toLowerCase().replace('_', ' ')} ${p.data.subjectId}` : '',
  },
];

const DEFAULT_COL_DEF = { sortable: false, resizable: true, suppressHeaderMenuButton: true };
const getRowId = (p: { data: AuditEntry }) => p.data.id;

export function AuditGrid({ entries, search }: { entries: readonly AuditEntry[]; search: string }) {
  return (
    <div data-testid="audit-grid" className="h-[36rem] w-full">
      <TermsGrid<AuditEntry>
        rowData={entries as AuditEntry[]}
        columnDefs={COLUMNS}
        defaultColDef={DEFAULT_COL_DEF}
        getRowId={getRowId}
        quickFilterText={search}
        suppressColumnVirtualisation
        enableCellTextSelection
      />
    </div>
  );
}
