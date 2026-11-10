import { type ListInvoicesResponse, type RunwayResponse } from '@terms/shared';
import { type AgDataSourcesDefinition, type AgFieldDefinition } from 'ag-studio';

/**
 * The owner's cash data as Studio tables, for the cash strategist's widgets. Values are the
 * server's, converted to numbers only so Studio can chart them; nothing is worked out here.
 */

const amount = (money: string): number => Number(money);

export interface InvoiceRecord {
  invoice: string;
  client: string;
  amountDue: number;
  dueDate: string;
  daysUntilDue: number;
  paypalStatus: string;
  action: string;
  discountPct: number | null;
  planCost: number;
  dealState: string;
}

export interface RunwayRecord {
  date: string;
  before: number;
  afterCommitted: number;
  afterPlanned: number;
}

export function invoiceRecords(invoices: ListInvoicesResponse): InvoiceRecord[] {
  return invoices.rows.map((row) => ({
    invoice: row.number,
    client: row.client.name,
    amountDue: amount(row.amountDue),
    dueDate: row.dueDate,
    daysUntilDue: row.daysUntilDue,
    paypalStatus: row.paypalStatus,
    action: row.planItem?.action ?? 'NONE',
    discountPct: row.planItem?.discountPct ? amount(row.planItem.discountPct) : null,
    planCost: row.planItem ? amount(row.planItem.cost) : 0,
    dealState: row.deal?.state ?? 'NONE',
  }));
}

export function runwayRecords(runway: RunwayResponse): RunwayRecord[] {
  return runway.points.map((point) => ({
    date: point.date,
    before: amount(point.before),
    afterCommitted: amount(point.afterCommitted),
    afterPlanned: amount(point.afterPlanned),
  }));
}

const dollars = { format: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }) };

/** The runway's fields, declared so the what-if table has them before it has any rows. */
const RUNWAY_FIELDS: AgFieldDefinition[] = [
  { id: 'date', name: 'Date', format: 'dateFormat' },
  { id: 'before', name: 'Before the plan', format: 'currencyFormat', formatOptions: dollars },
  {
    id: 'afterCommitted',
    name: 'With committed cash',
    format: 'currencyFormat',
    formatOptions: dollars,
  },
  {
    id: 'afterPlanned',
    name: 'If every offer is accepted',
    format: 'currencyFormat',
    formatOptions: dollars,
  },
];

/**
 * The tables Studio gets. Studio takes new rows for a table but no new tables once it has started,
 * so the what-if table is there from the start, empty until the server answers a what-if.
 */
export function studioSources(
  invoices: ListInvoicesResponse,
  runway: RunwayResponse | null,
): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: 'invoices',
        name: 'Open invoices',
        description: 'Invoices from PayPal, with the plan row and deal for each.',
        primaryKeyField: 'invoice',
        data: invoiceRecords(invoices),
      },
      {
        id: 'runway',
        name: 'Cash runway',
        description:
          'End-of-day balance: before the plan, with committed cash, and if every offer is accepted.',
        primaryKeyField: 'date',
        fields: RUNWAY_FIELDS,
        data: runway ? runwayRecords(runway) : [],
      },
      {
        id: 'scenario',
        name: 'What-if runway',
        description:
          'The runway under the last what-if the server ran, such as a cap on discounts. Empty until one runs.',
        primaryKeyField: 'date',
        fields: [...RUNWAY_FIELDS, { id: 'label', name: 'What-if', format: 'textFormat' }],
        data: [],
      },
    ],
  };
}
