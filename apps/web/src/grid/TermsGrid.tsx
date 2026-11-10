import {
  CellStyleModule,
  ClientSideRowModelModule,
  CustomEditorModule,
  enableDevValidations,
  HighlightChangesModule,
  NumberEditorModule,
  PinnedRowModule,
  QuickFilterModule,
  RowAutoHeightModule,
  RowStyleModule,
  TextEditorModule,
} from 'ag-grid-community';
import {
  ColumnsToolPanelModule,
  MasterDetailModule,
  RowGroupingModule,
  SideBarModule,
} from 'ag-grid-enterprise';
import { AgGridProvider, AgGridReact, type AgGridReactProps } from 'ag-grid-react';
import { termsGridTheme } from './theme';

if (import.meta.env.DEV) enableDevValidations();

/**
 * Only the features the app's grids use, so the download stays small (AllEnterpriseModule was
 * 2.7 MB). In development, AG Grid's validations log an error naming any module a grid needs and
 * lacks, and the browser tests fail on it.
 */
const modules = [
  ClientSideRowModelModule,
  // Workbench: groups by action, with money totals per group.
  RowGroupingModule,
  // Workbench and Payables Desk: a row opens to its reasoning and conversation.
  MasterDetailModule,
  // Workbench: the plan total pinned under the rows.
  PinnedRowModule,
  // Workbench: the column picker.
  SideBarModule,
  ColumnsToolPanelModule,
  // Workbench: the action select, and the amount and discount cells.
  CustomEditorModule,
  TextEditorModule,
  NumberEditorModule,
  // Workbench: a cell a live update changed flashes.
  HighlightChangesModule,
  // Workbench: editable cells and saving rows are styled by rule.
  CellStyleModule,
  RowStyleModule,
  // Audit trail: search, and details that wrap onto more lines.
  QuickFilterModule,
  RowAutoHeightModule,
];
const licenseKey = import.meta.env.VITE_AG_GRID_LICENSE_KEY;

/**
 * Every grid in the app. Registers the AG Grid modules the app uses, applies the licence (without one the grid
 * still works and shows a watermark) and the Terms theme. The parent must give it a height,
 * unless `domLayout` is `autoHeight`.
 */
export function TermsGrid<TData>(props: AgGridReactProps<TData>) {
  return (
    <AgGridProvider modules={modules} {...(licenseKey ? { licenseKey } : {})}>
      <AgGridReact<TData> theme={termsGridTheme} {...props} />
    </AgGridProvider>
  );
}
