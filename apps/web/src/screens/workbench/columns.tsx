import { fromCents, sumCents, toCents } from '@terms/shared';
import { type ColDef } from 'ag-grid-community';
import { ActionEditor } from './ActionEditor';
import {
  ActionCell,
  AgentCell,
  AmountCell,
  ApprovalCell,
  AskCell,
  ClientCell,
  CommittedCell,
  ContactCell,
  CostCell,
  DealStateCell,
  DiscountCell,
  DueCell,
  IfAgreedCell,
  PayPalStatusCell,
  RateCell,
} from './cells';
import { type AnyRow, isInvoiceRow, type WorkbenchRow } from './rows';
import { type EditField, isOfferAction } from './validateEdit';

export interface ColumnDeps {
  /** Narrow screens: nothing is pinned on the right, so the decision columns keep their room. */
  compact?: boolean;
  /** True while the plan is a draft. An approved plan can't be edited. */
  canEdit: boolean;
  /** Called when the owner finishes an edit. The grid never changes its own data. */
  onEdit: (row: WorkbenchRow, field: EditField, raw: string) => void;
}

/** Adds money held as decimal strings in exact cents. Returns null when there is nothing to add. */
export function sumMoney(values: readonly unknown[]): string | null {
  const amounts = values.filter((v): v is string => typeof v === 'string');
  return amounts.length === 0 ? null : fromCents(sumCents(amounts.map(toCents)));
}

/** Cost or planned cash for a row, or null where nothing is offered (so group totals stay blank). */
function offerMoney(row: AnyRow | undefined, key: 'cost' | 'ifAgreed'): string | null {
  if (!row) return null;
  if (!isInvoiceRow(row)) return row[key];
  return row.discountPct === null ? null : row[key];
}

/** AG Grid's aggregation hook, using the exact-cents sum above. */
const aggregateMoney = (params: { values: readonly unknown[] }): string | null =>
  sumMoney(params.values);

const invoiceValue =
  <K extends keyof WorkbenchRow>(key: K) =>
  (params: { data: AnyRow | undefined }): WorkbenchRow[K] | null =>
    isInvoiceRow(params.data) ? params.data[key] : null;

/**
 * Edits are not applied by the grid. The value setter hands the new value to `onEdit`, which
 * checks it, sends it to the server, and returns false so the grid keeps showing the server's value
 * until the server answers.
 */
function editSetter(field: EditField, deps: ColumnDeps) {
  return (params: { data: AnyRow; newValue: unknown }): boolean => {
    if (isInvoiceRow(params.data)) deps.onEdit(params.data, field, String(params.newValue));
    return false;
  };
}

function editableWhen(deps: ColumnDeps, needsOffer: boolean) {
  return (params: { data: AnyRow | undefined }): boolean => {
    const row = params.data;
    if (!deps.canEdit || !isInvoiceRow(row) || !row.contactAllowed || row.item === null)
      return false;
    return needsOffer ? isOfferAction(row.action) : true;
  };
}

/** Outcomes stay in view on wide screens. On narrow ones they scroll with the rest. */
function pinnedRight(deps: ColumnDeps): { pinned?: 'right' } {
  return deps.compact === true ? {} : { pinned: 'right' };
}

export function buildColumns(deps: ColumnDeps): ColDef<AnyRow>[] {
  const editableClass = (params: { data: AnyRow | undefined }): boolean =>
    editableWhen(deps, false)(params);
  return [
    {
      colId: 'group',
      headerName: 'Group',
      rowGroup: true,
      hide: true,
      valueGetter: invoiceValue('groupLabel'),
    },
    {
      colId: 'action',
      headerName: 'Action',
      width: 150,
      valueGetter: invoiceValue('action'),
      valueSetter: editSetter('action', deps),
      editable: editableWhen(deps, false),
      cellEditor: ActionEditor,
      cellRenderer: ActionCell,
      cellClassRules: { 'terms-editable': editableClass },
    },
    {
      colId: 'ask',
      headerName: 'Asked early',
      width: 176,
      type: 'rightAligned',
      valueGetter: invoiceValue('amountEarly'),
      valueSetter: editSetter('amountEarly', deps),
      editable: editableWhen(deps, true),
      cellRenderer: AskCell,
      cellClassRules: { 'terms-editable': editableWhen(deps, true) },
    },
    {
      colId: 'discount',
      headerName: 'Discount',
      width: 92,
      type: 'rightAligned',
      valueGetter: invoiceValue('discountPct'),
      valueSetter: editSetter('discountPct', deps),
      editable: editableWhen(deps, true),
      cellRenderer: DiscountCell,
      cellClassRules: { 'terms-editable': editableWhen(deps, true) },
    },
    {
      colId: 'cost',
      headerName: 'Cost to you',
      width: 104,
      type: 'rightAligned',
      valueGetter: (params) => offerMoney(params.data, 'cost'),
      aggFunc: aggregateMoney,
      cellRenderer: CostCell,
    },
    {
      colId: 'number',
      headerName: 'Invoice',
      width: 84,
      valueGetter: invoiceValue('number'),
    },
    {
      colId: 'amountDue',
      headerName: 'Amount',
      width: 108,
      type: 'rightAligned',
      valueGetter: invoiceValue('amountDue'),
      cellRenderer: AmountCell,
    },
    {
      colId: 'due',
      headerName: 'Due',
      width: 120,
      valueGetter: invoiceValue('daysUntilDue'),
      cellRenderer: DueCell,
    },
    {
      colId: 'paypalStatus',
      headerName: 'PayPal',
      width: 96,
      valueGetter: invoiceValue('paypalStatus'),
      cellRenderer: PayPalStatusCell,
    },
    {
      colId: 'contact',
      headerName: 'Contact',
      width: 136,
      valueGetter: invoiceValue('contactAllowed'),
      cellRenderer: ContactCell,
    },
    {
      colId: 'agent',
      headerName: 'Agent',
      width: 116,
      valueGetter: invoiceValue('hasAgent'),
      cellRenderer: AgentCell,
    },
    {
      colId: 'rate',
      headerName: 'Client return',
      width: 128,
      valueGetter: invoiceValue('rate'),
      cellRenderer: RateCell,
    },
    {
      colId: 'ifAgreed',
      headerName: 'If agreed',
      width: 104,
      type: 'rightAligned',
      valueGetter: (params) => offerMoney(params.data, 'ifAgreed'),
      aggFunc: aggregateMoney,
      cellRenderer: IfAgreedCell,
    },
    {
      colId: 'committed',
      headerName: 'Committed',
      width: 150,
      ...pinnedRight(deps),
      type: 'rightAligned',
      valueGetter: (params) =>
        isInvoiceRow(params.data) ? params.data.committed : (params.data?.committed ?? null),
      aggFunc: aggregateMoney,
      cellRenderer: CommittedCell,
    },
    {
      colId: 'dealState',
      headerName: 'Deal state',
      width: 158,
      ...pinnedRight(deps),
      valueGetter: invoiceValue('dealState'),
      cellRenderer: DealStateCell,
    },
    {
      colId: 'approval',
      headerName: 'Approval',
      width: 140,
      ...pinnedRight(deps),
      valueGetter: invoiceValue('approval'),
      cellRenderer: ApprovalCell,
    },
  ];
}

/** The client column, shown as the group column so the expand arrows and group names share it. */
export function buildAutoGroupColumn(compact: boolean): ColDef<AnyRow> {
  return {
    headerName: 'Client',
    pinned: 'left',
    minWidth: compact ? 170 : 210,
    width: compact ? 170 : 210,
    valueGetter: (params) =>
      isInvoiceRow(params.data) ? params.data.clientName : (params.data?.label ?? ''),
    cellRendererParams: { innerRenderer: ClientCell },
  };
}
