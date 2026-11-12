/**
 * Import from PayPal (CONTEXT.md, "How it works" step 1: no data entry): the supplier's invoices
 * (Invoicing), recent transactions (Transaction Search, through the APIMatic SDK) and the balance.
 * Terms keeps a mirror; PayPal stays authoritative, and every sync refreshes the mirror.
 *  - Invoices are matched to client businesses by the recipient's email; an unknown recipient
 *    becomes a client business (role CLIENT, no agent) so the Workbench shows every invoice.
 *  - Transaction Search allows at most 31 days per query and lags about two hours (spike S4); the
 *    sync walks the window in 31-day slices with a page cap, and records how far it covers.
 *  - The balance carries PayPal's own "as of" time.
 */
import { formatMoney, fromCents, isoDateInTimeZone, toCents } from '@terms/shared';
import { type PaypalClient } from 'paypal';
import { z } from 'zod';
import { type AiFlowLabeller, type TransactionToLabel } from '../ai/labeller-role.js';
import { type AuditLogger } from '../audit.js';
import { type Db } from '../db.js';
import { AppError } from '../errors.js';
import { type CashEventKind, type Prisma } from '../generated/prisma/client.js';
import { isoToDate } from '../mappers.js';
import { classify, toAppError } from './errors.js';
import { figuresOf, mirroredStatus, WireInvoice } from './invoice-wire.js';
import { type PayPalRestClient } from './rest-client.js';
import { callBudget } from './sdk-client.js';

/** How far back transactions are imported. */
export const HISTORY_DAYS = 90;
/** Transaction Search accepts at most 31 days per query. */
const WINDOW_DAYS = 31;
const MAX_PAGES = 20;

const InvoicePage = z.looseObject({
  items: z.array(z.looseObject({ id: z.string() })).default([]),
  total_pages: z.number().int().optional(),
});

const RecipientInvoice = WireInvoice.and(
  z.looseObject({
    detail: z.looseObject({
      invoice_date: z.string().optional(),
      payment_term: z.looseObject({ due_date: z.string().optional() }).optional(),
    }),
    primary_recipients: z
      .array(
        z.looseObject({
          billing_info: z
            .looseObject({
              email_address: z.string().optional(),
              business_name: z.string().optional(),
            })
            .optional(),
        }),
      )
      .optional(),
  }),
);

export interface SyncResult {
  syncedAt: Date;
  invoices: { imported: number; updated: number; unchanged: number; total: number };
  transactions: {
    imported: number;
    total: number;
    coveredFrom: Date | null;
    coveredTo: Date | null;
  };
  balance: {
    availableCents: bigint;
    currency: string;
    source: 'PAYPAL_BALANCES' | 'LEDGER';
    asOf: Date;
  };
}

/** PayPal transaction event codes, by family (T00xx payments, T04xx withdrawals, T05xx payouts…). */
export function kindOfEvent(code: string | undefined, amountCents: bigint): CashEventKind {
  if (code === undefined) return 'OTHER';
  if (code.startsWith('T0007') || code === 'T0006' || code.startsWith('T0011')) {
    return amountCents >= 0n ? 'INVOICE_PAYMENT' : 'OTHER';
  }
  if (code.startsWith('T05') || code.startsWith('T04') || code.startsWith('T03')) return 'TRANSFER';
  return 'OTHER';
}

const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'client';

export class SyncService {
  constructor(
    private readonly db: Db,
    private readonly rest: PayPalRestClient,
    private readonly sdk: PaypalClient,
    private readonly audit: AuditLogger,
    private readonly now: () => Date = () => new Date(),
    /** Labels transactions the event code could not classify; null: they keep PayPal's words. */
    private readonly labeller: AiFlowLabeller | null = null,
  ) {}

  private async clientFor(email: string | undefined, name: string | undefined): Promise<string> {
    const address = email?.trim().toLowerCase();
    if (address !== undefined && address.length > 0) {
      const known = await this.db.business.findFirst({
        where: { paypalEmail: { equals: address, mode: 'insensitive' } },
      });
      if (known !== null) return known.id;
    }
    const display = name?.trim() ?? address ?? 'PayPal customer';
    let slug = slugOf(display);
    for (let n = 2; (await this.db.business.count({ where: { slug } })) > 0; n++)
      slug = `${slugOf(display)}-${String(n)}`;
    const created = await this.db.business.create({
      data: { name: display, slug, role: 'CLIENT', paypalEmail: address ?? null },
    });
    return created.id;
  }

  async importInvoices(supplierId: string): Promise<SyncResult['invoices']> {
    const supplier = await this.db.business.findUniqueOrThrow({
      where: { id: supplierId },
      include: { supplierPolicy: true },
    });
    const ids: string[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.rest.request({
        method: 'GET',
        path: '/v2/invoicing/invoices',
        query: { page, page_size: 100, total_required: true },
        schema: InvoicePage,
      });
      ids.push(...res.data.items.map((i) => i.id));
      if (res.data.items.length === 0 || page >= (res.data.total_pages ?? page)) break;
    }
    const counts = { imported: 0, updated: 0, unchanged: 0, total: ids.length };
    const protectedIds = new Set(supplier.supplierPolicy?.doNotContact ?? []);
    for (const id of ids) {
      // The list carries summaries; the invoice itself is read for amounts and payments.
      const wire = (
        await this.rest.request({
          method: 'GET',
          path: `/v2/invoicing/invoices/${encodeURIComponent(id)}`,
          schema: RecipientInvoice,
        })
      ).data;
      if (wire.status === 'DRAFT') {
        counts.total -= 1;
        continue;
      }
      const recipient = wire.primary_recipients?.[0]?.billing_info;
      const clientId = await this.clientFor(recipient?.email_address, recipient?.business_name);
      const f = figuresOf(wire);
      const issue = wire.detail.invoice_date;
      const due =
        wire.detail.payment_term?.due_date ??
        issue ??
        isoDateInTimeZone(this.now(), supplier.timeZone);
      const data = {
        supplierId,
        clientId,
        number: wire.detail.invoice_number ?? id,
        amountCents: f.totalCents,
        currency: wire.amount?.currency_code ?? 'USD',
        issueDate: issue === undefined ? null : isoToDate(issue),
        dueDate: isoToDate(due),
        paypalStatus: mirroredStatus(wire.status),
        amountPaidCents: f.paidCents,
        amountDueCents: f.dueCents,
        contactAllowed: !protectedIds.has(clientId),
        paypalUrl: wire.detail.metadata?.recipient_view_url ?? null,
        isDemo: supplier.isDemo,
        lastSyncedAt: this.now(),
      } satisfies Omit<Prisma.InvoiceUncheckedCreateInput, 'paypalInvoiceId'>;
      const existing = await this.db.invoice.findUnique({ where: { paypalInvoiceId: id } });
      if (existing === null) {
        await this.db.invoice.create({ data: { paypalInvoiceId: id, ...data } });
        counts.imported += 1;
      } else {
        const changed =
          existing.paypalStatus !== data.paypalStatus ||
          existing.amountCents !== data.amountCents ||
          existing.amountDueCents !== data.amountDueCents ||
          existing.amountPaidCents !== data.amountPaidCents ||
          existing.dueDate.getTime() !== data.dueDate.getTime();
        await this.db.invoice.update({ where: { id: existing.id }, data });
        counts[changed ? 'updated' : 'unchanged'] += 1;
      }
    }
    return counts;
  }

  async importTransactions(supplierId: string): Promise<SyncResult['transactions']> {
    const end = this.now();
    const start = new Date(end.getTime() - HISTORY_DAYS * 86_400_000);
    const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');
    let imported = 0;
    let total = 0;
    let lastRefreshed: Date | null = null;
    const unclassified: TransactionToLabel[] = [];
    for (let from = start; from < end; from = new Date(from.getTime() + WINDOW_DAYS * 86_400_000)) {
      const to = new Date(
        Math.min(from.getTime() + WINDOW_DAYS * 86_400_000 - 1000, end.getTime()),
      );
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await this.sdk.transactionSearch.searchTransactions(
          { startDate: iso(from), endDate: iso(to), page },
          { signal: callBudget() },
        );
        if (res.lastRefreshedDatetime !== undefined)
          lastRefreshed = new Date(res.lastRefreshedDatetime);
        for (const detail of res.transactionDetails ?? []) {
          const info = detail.transactionInfo;
          const txnId = info?.transactionId;
          const value = info?.transactionAmount?.value;
          const date = info?.transactionInitiationDate;
          if (txnId === undefined || value === undefined || date === undefined) continue;
          total += 1;
          const cents = toCents(Number(value).toFixed(2));
          // Transactions never change once PayPal reports them: import each one once.
          if ((await this.db.cashEvent.count({ where: { paypalTxnId: txnId } })) > 0) continue;
          const kind = kindOfEvent(info?.transactionEventCode, cents);
          const label =
            info?.transactionSubject ??
            info?.transactionNote ??
            info?.transactionEventCode ??
            'PayPal transaction';
          const event = await this.db.cashEvent.create({
            data: {
              businessId: supplierId,
              date: isoToDate(date.slice(0, 10)),
              amountCents: cents < 0n ? -cents : cents,
              direction: cents < 0n ? 'OUT' : 'IN',
              kind,
              source: 'PAYPAL_TXN',
              label,
              paypalTxnId: txnId,
            },
          });
          imported += 1;
          if (kind === 'OTHER') {
            unclassified.push({
              id: event.id,
              date: date.slice(0, 10),
              direction: cents < 0n ? 'OUT' : 'IN',
              amount: fromCents(cents < 0n ? -cents : cents),
              description: label,
            });
          }
        }
        if ((res.totalPages ?? page) <= page) break;
      }
    }
    await this.labelUnclassified(unclassified);
    return { imported, total, coveredFrom: start, coveredTo: lastRefreshed ?? end };
  }

  /** Gives the transactions the event code left as OTHER a kind and label, if a labeller is set. */
  private async labelUnclassified(items: readonly TransactionToLabel[]): Promise<void> {
    if (this.labeller === null || items.length === 0) return;
    const labelled = await this.labeller.label(items);
    for (const [id, { kind, label }] of labelled) {
      await this.db.cashEvent.update({ where: { id }, data: { kind, label } });
    }
  }

  async readBalance(): Promise<SyncResult['balance']> {
    const res = await this.sdk.transactionSearch.searchBalances(
      { currencyCode: 'USD' },
      { signal: callBudget() },
    );
    const usd = res.balances?.find((b) => b.currency === 'USD');
    const value = usd?.availableBalance?.value;
    if (value === undefined) throw new AppError('PAYPAL_ERROR', 'PayPal returned no USD balance');
    return {
      availableCents: toCents(Number(value).toFixed(2)),
      currency: 'USD',
      source: 'PAYPAL_BALANCES',
      asOf: res.asOfTime === undefined ? this.now() : new Date(res.asOfTime),
    };
  }

  /** The full import, recorded on the supplier's PayPal account and in the audit trail. */
  async sync(supplierId: string): Promise<SyncResult> {
    try {
      const invoices = await this.importInvoices(supplierId);
      const transactions = await this.importTransactions(supplierId);
      const balance = await this.readBalance();
      const syncedAt = this.now();
      const account = {
        lastSyncedAt: syncedAt,
        balanceCents: balance.availableCents,
        balanceCurrency: balance.currency,
        balanceSource: balance.source,
        balanceAsOf: balance.asOf,
        txnCoveredFrom: transactions.coveredFrom,
        txnCoveredTo: transactions.coveredTo,
      };
      await this.db.payPalAccount.upsert({
        where: { businessId: supplierId },
        create: { businessId: supplierId, ...account },
        update: account,
      });
      await this.audit.write(this.db, {
        actor: 'SYSTEM',
        action: 'SYNC_COMPLETED',
        subjectType: 'BUSINESS',
        subjectId: supplierId,
        businessIds: [supplierId],
        summary: `Imported ${String(invoices.total)} invoices (${String(invoices.imported)} new) and ${String(transactions.total)} transactions; balance ${formatMoney(balance.availableCents)} as of ${balance.asOf.toISOString()}`,
        details: { invoices, transactions: { ...transactions }, balance: { ...balance } },
        paypalCall: 'GET /v2/invoicing/invoices',
      });
      return { syncedAt, invoices, transactions, balance };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw toAppError(classify(err), 'invoice');
    }
  }
}
