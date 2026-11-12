import { type IRowNode } from 'ag-grid-community';
import { useMemo } from 'react';
import { TermsGrid } from '../../grid/TermsGrid';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStableCallback } from '../../lib/useStableCallback';
import { buildAutoGroupColumn, buildColumns } from './columns';
import { DetailPanel } from './DetailPanel';
import { type AnyRow, groupRank, isInvoiceRow, type SummaryRow, type WorkbenchRow } from './rows';
import { type EditField } from './validateEdit';

export interface WorkbenchGridProps {
  rows: readonly WorkbenchRow[];
  summary: SummaryRow | null;
  /** True while the plan is a draft. */
  canEdit: boolean;
  onEdit: (row: WorkbenchRow, field: EditField, raw: string) => void;
  /** Rows with a change in flight. They are dimmed until the server answers. */
  saving: ReadonlySet<string>;
}

/** Only show/hide columns: no pivoting, grouping or aggregation controls. Closed until opened. */
const SIDE_BAR = {
  toolPanels: [
    {
      id: 'columns',
      labelDefault: 'Columns',
      labelKey: 'columns',
      iconKey: 'columns',
      toolPanel: 'agColumnsToolPanel',
      toolPanelParams: {
        suppressPivotMode: true,
        suppressRowGroups: true,
        suppressValues: true,
        suppressPivots: true,
        suppressColumnFilter: true,
      },
    },
  ],
  defaultToolPanel: '',
};

const DEFAULT_COL_DEF = { sortable: false, resizable: true, suppressHeaderMenuButton: true };
const ROW_CLASS_RULES = {
  'terms-saving': (params: { data: AnyRow | undefined }) =>
    isInvoiceRow(params.data) && params.data.saving === true,
};
// Function options must keep their identity: AG Grid treats a new function as a changed setting,
// and a changed setting closes any editor the owner has open.
const isRowMaster = (data: AnyRow) => isInvoiceRow(data);
const compareGroups = (params: { nodeA: IRowNode<AnyRow>; nodeB: IRowNode<AnyRow> }) =>
  groupRank(params.nodeA.key ?? '') - groupRank(params.nodeB.key ?? '');
const getRowId = (params: { data: AnyRow }) => params.data.id;

/** The Workbench: one row per invoice, grouped by action, with the plan editable in place. */
export function WorkbenchGrid({ rows, summary, canEdit, onEdit, saving }: WorkbenchGridProps) {
  const compact = useMediaQuery('(max-width: 1100px)');
  const stableOnEdit = useStableCallback(onEdit);

  // Column definitions are stable, so editing one cell doesn't reset the grid's state.
  const columnDefs = useMemo(
    () => buildColumns({ canEdit, compact, onEdit: stableOnEdit }),
    [canEdit, compact, stableOnEdit],
  );
  const autoGroupColumnDef = useMemo(() => buildAutoGroupColumn(compact), [compact]);
  const pinned = useMemo(() => (summary ? [summary] : []), [summary]);
  // The flag travels with the row, so saving one row never disturbs an editor open in another.
  const rowData = useMemo<AnyRow[]>(
    () => rows.map((row) => (saving.has(row.id) ? { ...row, saving: true } : row)),
    [rows, saving],
  );

  return (
    <div data-testid="workbench-grid" className="h-[34rem] min-h-80 w-full">
      <TermsGrid<AnyRow>
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        autoGroupColumnDef={autoGroupColumnDef}
        groupDisplayType="singleColumn"
        groupDefaultExpanded={-1}
        masterDetail
        masterDefaultExpanded={0}
        isRowMaster={isRowMaster}
        detailCellRenderer={DetailPanel}
        detailRowAutoHeight
        pinnedBottomRowData={pinned}
        getRowId={getRowId}
        rowClassRules={ROW_CLASS_RULES}
        sideBar={SIDE_BAR}
        suppressAggFuncInHeader
        suppressColumnVirtualisation
        initialGroupOrderComparator={compareGroups}
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        suppressMovableColumns
      />
    </div>
  );
}
