import { type ColDef } from 'ag-grid-community';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockWorld } from '../../mocks/world';
import { buildAutoGroupColumn, buildColumns, sumMoney } from './columns';
import { type AnyRow, toSummaryRow, toWorkbenchRows, type WorkbenchRow } from './rows';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

let rows: Record<string, WorkbenchRow>;
let summary: AnyRow;

beforeEach(() => {
  const world = new MockWorld();
  world.parseGoal(SENTENCE);
  const plan = world.createPlan();
  rows = Object.fromEntries(
    toWorkbenchRows(world.invoiceRows(), 'DRAFT').map((r) => [r.clientName, r]),
  );
  summary = toSummaryRow(plan.summary);
});

type Fn = (params: Record<string, unknown>) => unknown;

function column(id: string, canEdit = true, onEdit = vi.fn()): ColDef<AnyRow> {
  const found = buildColumns({ canEdit, onEdit }).find((c) => c.colId === id);
  if (!found) throw new Error(`No column ${id}`);
  return found;
}
const call = (fn: unknown, params: Record<string, unknown>) => (fn as Fn)(params);

describe('sumMoney', () => {
  it('adds in exact cents, with no floating-point drift', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['40.00', '14.00'])).toBe('54.00');
    expect(sumMoney(['99999999999.99', '0.01'])).toBe('100000000000.00');
  });

  it('is blank when there is nothing to add', () => {
    expect(sumMoney([])).toBeNull();
    expect(sumMoney([null, undefined, 3])).toBeNull();
  });
});

describe('editing rules', () => {
  it('lets the owner change the action of a contactable row in a draft plan', () => {
    const editable = column('action').editable;
    expect(call(editable, { data: rows['Juniper Labs'] })).toBe(true);
    expect(call(editable, { data: rows['Oak Street Bakery'] })).toBe(true);
  });

  it('never lets the owner touch a protected client', () => {
    for (const id of ['action', 'ask', 'discount']) {
      expect(call(column(id).editable, { data: rows['Pinecrest Dental'] }), id).toBe(false);
      expect(call(column(id).editable, { data: rows['Birch Legal'] }), id).toBe(false);
    }
  });

  it('freezes every cell once the plan is approved', () => {
    for (const id of ['action', 'ask', 'discount']) {
      expect(call(column(id, false).editable, { data: rows['Juniper Labs'] }), id).toBe(false);
    }
  });

  it('allows a discount or an amount only where an offer exists', () => {
    expect(call(column('discount').editable, { data: rows['Harbor & Co'] })).toBe(true);
    expect(call(column('ask').editable, { data: rows['Harbor & Co'] })).toBe(true);
    expect(call(column('discount').editable, { data: rows['Oak Street Bakery'] })).toBe(false);
    expect(call(column('ask').editable, { data: rows['Oak Street Bakery'] })).toBe(false);
  });

  it('never makes the pinned summary row editable', () => {
    expect(call(column('action').editable, { data: summary })).toBe(false);
    expect(call(column('discount').editable, { data: summary })).toBe(false);
  });

  it('hands an edit to the callback and keeps the grid on the server’s value', () => {
    const onEdit = vi.fn();
    const result = call(column('discount', true, onEdit).valueSetter, {
      data: rows['Harbor & Co'],
      newValue: '1.5',
    });
    expect(result).toBe(false);
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(rows['Harbor & Co'], 'discountPct', '1.5');
  });

  it('turns a typed number into text before handing it over', () => {
    const onEdit = vi.fn();
    call(column('ask', true, onEdit).valueSetter, { data: rows['Harbor & Co'], newValue: 1750 });
    expect(onEdit).toHaveBeenCalledWith(rows['Harbor & Co'], 'amountEarly', '1750');
  });

  it('ignores an edit that arrives on the summary row', () => {
    const onEdit = vi.fn();
    expect(
      call(column('action', true, onEdit).valueSetter, { data: summary, newValue: 'NONE' }),
    ).toBe(false);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('money columns', () => {
  it('shows cost only where something is offered, so group totals stay blank otherwise', () => {
    const cost = column('cost').valueGetter;
    expect(call(cost, { data: rows['Juniper Labs'] })).toBe('40.00');
    expect(call(cost, { data: rows['Oak Street Bakery'] })).toBeNull();
    expect(call(cost, { data: rows['Pinecrest Dental'] })).toBeNull();
    expect(call(cost, { data: summary })).toBe('54.00');
  });

  it('shows planned cash separately from committed cash', () => {
    expect(call(column('ifAgreed').valueGetter, { data: rows['Juniper Labs'] })).toBe('4960.00');
    expect(call(column('committed').valueGetter, { data: rows['Juniper Labs'] })).toBeNull();
    expect(call(column('committed').valueGetter, { data: summary })).toBe('0.00');
  });

  it('pins the outcome columns to the right so they are always in view', () => {
    for (const id of ['committed', 'dealState', 'approval']) {
      expect(column(id).pinned, id).toBe('right');
    }
  });

  it('leaves them unpinned on narrow screens so the decision columns keep their room', () => {
    const compact = buildColumns({ canEdit: true, compact: true, onEdit: vi.fn() });
    for (const id of ['committed', 'dealState', 'approval']) {
      expect(compact.find((c) => c.colId === id)?.pinned, id).toBeUndefined();
    }
  });

  it('keeps the helper group column out of the column picker', () => {
    expect(column('group').suppressColumnsToolPanel).toBe(true);
  });

  it('puts the decision columns right after the client', () => {
    const ids = buildColumns({ canEdit: true, onEdit: vi.fn() }).map((c) => c.colId);
    expect(ids.slice(0, 5)).toEqual(['group', 'action', 'ask', 'discount', 'cost']);
  });
});

describe('buildAutoGroupColumn', () => {
  it('flashes the deal state and committed cells when a live update changes them', () => {
    expect(column('dealState').enableCellChangeFlash).toBe(true);
    expect(column('committed').enableCellChangeFlash).toBe(true);
    expect(column('action').enableCellChangeFlash).toBeUndefined();
  });

  it('keeps the client column pinned and narrower on small screens', () => {
    expect(buildAutoGroupColumn(false)).toMatchObject({ pinned: 'left', width: 210 });
    expect(buildAutoGroupColumn(true)).toMatchObject({ pinned: 'left', width: 170 });
  });
});
