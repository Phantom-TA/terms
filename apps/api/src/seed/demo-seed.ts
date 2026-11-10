/**
 * The demo seed (CONTEXT.md, "Demo scenario, seed data"): every object in the demo is real.
 *  - Terms records: the six businesses (labelled demo), Maya's policy (max 1.2%, Pinecrest and
 *    Birch protected, 5% buffer, $60 ceiling), Juniper's and Harbor's agent policies, and Maya's
 *    confirmed payroll of $11,400 on Friday.
 *  - PayPal sandbox: real invoices from Maya Studio, created and sent: Oak Street #1038 ($1,800,
 *    six days overdue), Pinecrest #1039, Juniper #1041 ($5,000), Birch #1042, Harbor #1043 ($7,500).
 *    Each write is claimed in the ledger first, so a re-run never creates or sends one twice.
 *  - Then a real import (SyncService) mirrors them, with transactions and the balance.
 * `reset` withdraws the previous run: open demo invoices are cancelled in PayPal and Terms' demo
 * history is cleared. `cancelStray` also cancels open invoices this seed did not create (spike
 * leftovers) so the Workbench shows only the demo.
 */
import { randomUUID } from 'node:crypto';
import { addDays, dollars, isoDateInTimeZone, nextWeekday } from '@terms/shared';
import { z } from 'zod';
import { type Db } from '../db.js';
import { AppError } from '../errors.js';
import { classify, toAppError } from '../paypal/errors.js';
import { type SyncResult } from '../paypal/sync-service.js';
import { type PayPalServices } from '../services.js';
import { type WriteLedger } from '../paypal/write-ledger.js';
import { isoToDate } from '../mappers.js';

export const DEMO_TIME_ZONE = 'America/New_York';

export interface DemoAccounts {
  maya: string;
  juniper: string;
  harbor: string;
  oak: string;
  pinecrest: string;
  birch: string;
}

/** The sandbox accounts the owner created (docs/paypal.md). */
export const SANDBOX_ACCOUNTS: DemoAccounts = {
  maya: 'maya@terms-demo.example.com',
  juniper: 'juniper@terms-demo.example.com',
  harbor: 'harbor@terms-demo.example.com',
  oak: 'oak@terms-demo.example.com',
  pinecrest: 'pinecrest@terms-demo.example.com',
  birch: 'birch@terms-demo.example.com',
};

interface InvoiceSpec {
  number: string;
  client: keyof Omit<DemoAccounts, 'maya'>;
  amount: number;
  /** Days from today; negative is overdue. */
  dueIn: number;
  item: string;
}

/** The scenario's five invoices (CONTEXT.md, "Starting position"). */
export const DEMO_INVOICES: readonly InvoiceSpec[] = [
  { number: '1038', client: 'oak', amount: 1800, dueIn: -6, item: 'Menu and window graphics' },
  { number: '1039', client: 'pinecrest', amount: 2000, dueIn: 9, item: 'Patient brochure design' },
  { number: '1041', client: 'juniper', amount: 5000, dueIn: 18, item: 'Product launch campaign' },
  { number: '1042', client: 'birch', amount: 1200, dueIn: 15, item: 'Letterhead and cards' },
  { number: '1043', client: 'harbor', amount: 7500, dueIn: 24, item: 'Brand system and website' },
];

export interface SeedOptions {
  accounts?: DemoAccounts;
  /** Appended to invoice numbers ("1041-B") when a previous run's numbers are taken. */
  suffix?: string;
  reset?: boolean;
  cancelStray?: boolean;
  /** Register Harbor's saved PayPal method (a payment token from the vault setup). */
  harborPaymentToken?: string;
  now?: () => Date;
}

export interface SeedReport {
  businesses: Record<keyof DemoAccounts, string>;
  invoices: { number: string; paypalInvoiceId: string; created: boolean; sent: boolean }[];
  cancelled: string[];
  payrollDate: string;
  sync: SyncResult;
  harborVault: 'registered' | 'already saved' | 'not set';
}

const Created = z.looseObject({ id: z.string().optional(), href: z.string().optional() });
const ListPage = z.looseObject({
  items: z.array(z.looseObject({ id: z.string(), status: z.string() })).default([]),
  total_pages: z.number().int().optional(),
});

export class DemoSeed {
  constructor(
    private readonly db: Db,
    private readonly paypal: PayPalServices,
    private readonly ledger: WriteLedger,
  ) {}

  private async upsertBusinesses(accounts: DemoAccounts) {
    const one = (
      slug: string,
      name: string,
      role: 'SUPPLIER' | 'CLIENT',
      hasAgent: boolean,
      email: string,
    ) =>
      this.db.business.upsert({
        where: { slug },
        create: {
          slug,
          name,
          role,
          hasAgent,
          paypalEmail: email,
          isDemo: true,
          timeZone: DEMO_TIME_ZONE,
        },
        update: {
          name,
          role,
          hasAgent,
          paypalEmail: email,
          isDemo: true,
          timeZone: DEMO_TIME_ZONE,
        },
      });
    const maya = await one('maya-studio', 'Maya Studio', 'SUPPLIER', false, accounts.maya);
    const juniper = await one('juniper-labs', 'Juniper Labs', 'CLIENT', true, accounts.juniper);
    const harbor = await one('harbor-co', 'Harbor & Co', 'CLIENT', true, accounts.harbor);
    const oak = await one('oak-street-bakery', 'Oak Street Bakery', 'CLIENT', false, accounts.oak);
    const pinecrest = await one(
      'pinecrest-dental',
      'Pinecrest Dental',
      'CLIENT',
      false,
      accounts.pinecrest,
    );
    const birch = await one('birch-legal', 'Birch Legal', 'CLIENT', false, accounts.birch);
    return {
      maya: maya.id,
      juniper: juniper.id,
      harbor: harbor.id,
      oak: oak.id,
      pinecrest: pinecrest.id,
      birch: birch.id,
    };
  }

  private async upsertPolicies(b: SeedReport['businesses']) {
    const supplier = {
      maxDiscountBps: 120,
      openingDiscountBps: null,
      doNotContact: [b.pinecrest, b.birch],
      bufferBps: 500,
      costCeilingCents: dollars(60),
      tone: 'FRIENDLY_BRIEF' as const,
    };
    await this.db.supplierPolicy.upsert({
      where: { businessId: b.maya },
      create: { businessId: b.maya, ...supplier },
      update: supplier,
    });
    const juniper = {
      hurdleBps: 1200,
      targetBps: 2000,
      cashBufferCents: dollars(20000),
      autoPayLimitCents: dollars(3000),
      earlyPayCapCents: null,
      neverPayEarly: [],
      cashOnHandCents: dollars(80000),
    };
    const harbor = {
      hurdleBps: 1500,
      targetBps: 2300,
      cashBufferCents: dollars(20000),
      autoPayLimitCents: dollars(2000),
      earlyPayCapCents: dollars(5000),
      neverPayEarly: [],
      cashOnHandCents: dollars(60000),
    };
    await this.db.clientPolicy.upsert({
      where: { businessId: b.juniper },
      create: { businessId: b.juniper, ...juniper },
      update: juniper,
    });
    await this.db.clientPolicy.upsert({
      where: { businessId: b.harbor },
      create: { businessId: b.harbor, ...harbor },
      update: harbor,
    });
  }

  /** Open invoices in Maya's PayPal account (every page, capped). */
  private async openPayPalInvoices(): Promise<string[]> {
    const open: string[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.paypal.rest.request({
        method: 'GET',
        path: '/v2/invoicing/invoices',
        query: { page, page_size: 100, total_required: true },
        schema: ListPage,
      });
      open.push(
        ...res.data.items
          .filter((i) => ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED'].includes(i.status))
          .map((i) => i.id),
      );
      if (res.data.items.length === 0 || page >= (res.data.total_pages ?? page)) break;
    }
    return open;
  }

  private async cancel(paypalInvoiceId: string): Promise<void> {
    await this.paypal.rest.request({
      method: 'POST',
      path: `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/cancel`,
      requestId: randomUUID(),
      body: {
        subject: 'Demo reset',
        note: 'Terms demo data reset',
        send_to_invoicer: false,
        send_to_recipient: false,
      },
      schema: z.unknown(),
    });
  }

  /** Clears Terms' demo history (keeps businesses, policies and saved PayPal methods). */
  private async clearHistory(supplierId: string): Promise<void> {
    const plans = await this.db.plan.findMany({
      where: { goal: { supplierId } },
      select: { id: true },
    });
    const planIds = plans.map((p) => p.id);
    const deals = await this.db.deal.findMany({
      where: { planId: { in: planIds } },
      select: { id: true },
    });
    const dealIds = deals.map((d) => d.id);
    await this.db.$transaction([
      this.db.paymentRecord.deleteMany({ where: { dealId: { in: dealIds } } }),
      this.db.approval.deleteMany({
        where: { OR: [{ dealId: { in: dealIds } }, { planId: { in: planIds } }] },
      }),
      this.db.deal.deleteMany({ where: { id: { in: dealIds } } }),
      this.db.planItem.deleteMany({ where: { planId: { in: planIds } } }),
      this.db.plan.deleteMany({ where: { id: { in: planIds } } }),
      this.db.goal.deleteMany({ where: { supplierId } }),
      this.db.invoice.deleteMany({ where: { supplierId } }),
      this.db.cashEvent.deleteMany({ where: { businessId: supplierId } }),
      this.db.payPalWrite.deleteMany({
        where: {
          OR: [
            { key: { startsWith: 'invoice-' } },
            { key: { startsWith: 'order:' } },
            { key: { startsWith: 'capture:' } },
          ],
        },
      }),
      this.db.eventLog.deleteMany({}),
    ]);
  }

  private async createAndSend(
    spec: InvoiceSpec,
    number: string,
    accounts: DemoAccounts,
    today: string,
  ) {
    const names: Record<InvoiceSpec['client'], string> = {
      oak: 'Oak Street Bakery',
      pinecrest: 'Pinecrest Dental',
      juniper: 'Juniper Labs',
      birch: 'Birch Legal',
      harbor: 'Harbor & Co',
    };
    const claim = await this.ledger.claim(this.db, {
      key: `invoice-create:${number}`,
      operation: 'invoicing.create',
    });
    let paypalId = claim.write.resultRef;
    let created = false;
    if (paypalId === null) {
      try {
        const res = await this.paypal.rest.request({
          method: 'POST',
          path: '/v2/invoicing/invoices',
          requestId: claim.write.requestId,
          prefer: 'return=representation',
          body: {
            detail: {
              invoice_number: number,
              currency_code: 'USD',
              invoice_date: addDays(today, Math.min(-12, spec.dueIn - 30)),
              payment_term: { due_date: addDays(today, spec.dueIn) },
              note: 'Terms demo data (PayPal sandbox)',
            },
            invoicer: { business_name: 'Maya Studio' },
            primary_recipients: [
              {
                billing_info: {
                  email_address: accounts[spec.client],
                  business_name: names[spec.client],
                },
              },
            ],
            items: [
              {
                name: spec.item,
                quantity: '1',
                unit_amount: { currency_code: 'USD', value: `${String(spec.amount)}.00` },
              },
            ],
            configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
          },
          schema: Created,
        });
        paypalId = res.data.id ?? res.data.href?.split('/').pop() ?? null;
        if (paypalId === null) throw new Error(`PayPal created invoice ${number} without an id`);
        await this.ledger.succeed(this.db, claim.write.id, paypalId);
        created = true;
      } catch (err) {
        await this.ledger.release(this.db, claim.write.id);
        const f = classify(err);
        const hint =
          f.reason?.toLowerCase().includes('duplicate') === true
            ? ' (use --suffix for a new run)'
            : '';
        throw new AppError(
          toAppError(f, 'invoice').code,
          `Invoice ${number}: ${f.reason ?? f.kind}${hint}`,
          {
            cause: err,
          },
        );
      }
    }
    const send = await this.ledger.claim(this.db, {
      key: `invoice-send:${paypalId}`,
      operation: 'invoicing.send',
    });
    let sent = send.write.status === 'SUCCEEDED';
    if (!sent) {
      await this.paypal.rest.request({
        method: 'POST',
        path: `/v2/invoicing/invoices/${encodeURIComponent(paypalId)}/send`,
        requestId: send.write.requestId,
        body: { send_to_invoicer: false, send_to_recipient: true },
        schema: z.unknown(),
      });
      await this.ledger.succeed(this.db, send.write.id, paypalId);
      sent = true;
    }
    return { number, paypalInvoiceId: paypalId, created, sent };
  }

  async run(options: SeedOptions = {}): Promise<SeedReport> {
    const accounts = options.accounts ?? SANDBOX_ACCOUNTS;
    const now = options.now ?? (() => new Date());
    const today = isoDateInTimeZone(now(), DEMO_TIME_ZONE);
    const businesses = await this.upsertBusinesses(accounts);
    await this.upsertPolicies(businesses);

    const cancelled: string[] = [];
    if (options.reset === true || options.cancelStray === true) {
      const open = new Set(await this.openPayPalInvoices());
      const mirrored = await this.db.invoice.findMany({
        where: { supplierId: businesses.maya, isDemo: true },
      });
      const targets =
        options.cancelStray === true
          ? [...open]
          : mirrored.map((i) => i.paypalInvoiceId).filter((id) => open.has(id));
      for (const id of targets) {
        await this.cancel(id);
        cancelled.push(id);
      }
    }
    if (options.reset === true) await this.clearHistory(businesses.maya);

    const invoices: SeedReport['invoices'] = [];
    for (const spec of DEMO_INVOICES) {
      const number =
        options.suffix === undefined ? spec.number : `${spec.number}-${options.suffix}`;
      invoices.push(await this.createAndSend(spec, number, accounts, today));
    }

    // Maya's payroll: the owner-confirmed recurring outflow the goal is about.
    const payrollDate = nextWeekday(today, 5);
    const payroll = await this.db.cashEvent.findFirst({
      where: {
        businessId: businesses.maya,
        kind: 'PAYROLL',
        source: 'CONFIRMED_RECURRING',
        date: isoToDate(payrollDate),
      },
    });
    if (payroll === null) {
      await this.db.cashEvent.create({
        data: {
          businessId: businesses.maya,
          date: isoToDate(payrollDate),
          amountCents: dollars(11400),
          direction: 'OUT',
          kind: 'PAYROLL',
          source: 'CONFIRMED_RECURRING',
          label: 'Payroll (3 people)',
        },
      });
    }

    let harborVault: SeedReport['harborVault'] = 'not set';
    const active = await this.db.vaultToken.findFirst({
      where: { clientId: businesses.harbor, status: 'ACTIVE' },
    });
    if (active !== null) harborVault = 'already saved';
    else if (options.harborPaymentToken !== undefined) {
      await this.db.vaultToken.create({
        data: {
          clientId: businesses.harbor,
          status: 'ACTIVE',
          paypalPaymentTokenId: options.harborPaymentToken,
          payerEmail: accounts.harbor,
        },
      });
      harborVault = 'registered';
    }

    // The real import: what the owner sees comes from PayPal.
    const sync = await this.paypal.sync.sync(businesses.maya);
    // Only this run's invoices are demo rows; anything else is the owner's own data.
    await this.db.invoice.updateMany({
      where: {
        supplierId: businesses.maya,
        paypalInvoiceId: { notIn: invoices.map((i) => i.paypalInvoiceId) },
      },
      data: { isDemo: false },
    });
    return { businesses, invoices, cancelled, payrollDate, sync, harborVault };
  }
}
