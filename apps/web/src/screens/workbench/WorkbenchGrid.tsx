import { type GridApi } from 'ag-grid-community';
import { useEffect, useMemo, useRef } from 'react';
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
const getRowId = (params: { data: AnyRow }) => params.data.id;

/** The Workbench: one row per invoice, grouped by action, with the plan editable in place. */
export function WorkbenchGrid({ rows, summary, canEdit, onEdit, saving }: WorkbenchGridProps) {
  const compact = useMediaQuery('(max-width: 1100px)');
  const apiRef = useRef<GridApi<AnyRow> | null>(null);
  const stableOnEdit = useStableCallback(onEdit);
  const savingRef = useRef(saving);

  useEffect(() => {
    savingRef.current = saving;
    apiRef.current?.redrawRows();
  }, [saving]);

  // Column definitions are stable, so editing one cell doesn't reset the grid's state.
  const columnDefs = useMemo(
    () => buildColumns({ canEdit, compact, onEdit: stableOnEdit }),
    [canEdit, compact, stableOnEdit],
  );
  const autoGroupColumnDef = useMemo(() => buildAutoGroupColumn(compact), [compact]);
  const pinned = useMemo(() => (summary ? [summary] : []), [summary]);
  const rowClassRules = useMemo(
    () => ({
      'terms-saving': (params: { data: AnyRow | undefined }) =>
        isInvoiceRow(params.data) && savingRef.current.has(params.data.id),
    }),
    [],
  );

  return (
    <div data-testid="workbench-grid" className="h-[34rem] min-h-80 w-full">
      <TermsGrid<AnyRow>
        rowData={rows as AnyRow[]}
        columnDefs={columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        autoGroupColumnDef={autoGroupColumnDef}
        groupDisplayType="singleColumn"
        groupDefaultExpanded={-1}
        masterDetail
        masterDefaultExpanded={0}
        isRowMaster={(data: AnyRow) => isInvoiceRow(data)}
        detailCellRenderer={DetailPanel}
        detailRowAutoHeight
        pinnedBottomRowData={pinned}
        getRowId={getRowId}
        rowClassRules={rowClassRules}
        sideBar={SIDE_BAR}
        suppressAggFuncInHeader
        suppressColumnVirtualisation
        initialGroupOrderComparator={(params) =>
          groupRank(params.nodeA.key ?? '') - groupRank(params.nodeB.key ?? '')
        }
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        suppressMovableColumns
        onGridReady={(event) => {
          apiRef.current = event.api;
        }}
      />
    </div>
  );
}
