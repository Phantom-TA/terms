/**
 * Builds every service once, at startup, and wires the cross-cutting listeners (audit entries and
 * deal changes become live events). The HTTP layer receives this container; tests build it with a
 * test database and a fake PayPal.
 */
import { ApprovalService } from './approvals/approval-service.js';
import { AuditLogger } from './audit.js';
import { type Config } from './config.js';
import { type Db } from './db.js';
import { DealStore } from './deals/deal-store.js';
import { GoalService } from './goals/goal-service.js';
import { dealSummary, dealSummaryInclude } from './http/deal-views.js';
import { EventBus } from './http/events.js';
import { SessionService } from './http/session.js';
import { type Logger } from './logger.js';
import { NegotiationEngine } from './negotiation/engine.js';
import { InvoiceService } from './paypal/invoice-service.js';
import { PaymentService } from './paypal/payment-service.js';
import { PayPalRestClient } from './paypal/rest-client.js';
import { buildPayPalSdkClient } from './paypal/sdk-client.js';
import { Settlement } from './paypal/settlement.js';
import { VaultService } from './paypal/vault-service.js';
import { WebhookService } from './paypal/webhook-service.js';
import { WriteLedger } from './paypal/write-ledger.js';
import { PlanService } from './plans/plan-service.js';

export interface PayPalServices {
  rest: PayPalRestClient;
  invoices: InvoiceService;
  vault: VaultService;
  payments: PaymentService;
  settlement: Settlement;
  webhooks: WebhookService;
}

export interface Services {
  config: Config;
  db: Db;
  logger: Logger;
  now: () => Date;
  audit: AuditLogger;
  deals: DealStore;
  approvals: ApprovalService;
  plans: PlanService;
  goals: GoalService;
  engine: NegotiationEngine;
  events: EventBus;
  sessions: SessionService;
  ledger: WriteLedger;
  /** Publishes deal.updated for deals after their change has committed. */
  publishDeals: (dealIds: readonly string[]) => Promise<void>;
  /** Null when PayPal credentials are not configured: PayPal routes answer NOT_CONFIGURED. */
  paypal: PayPalServices | null;
}

export interface ServiceOverrides {
  now?: () => Date;
  /** Test seam: the fake PayPal transport for both the SDK and the REST client. */
  paypalFetch?: typeof globalThis.fetch;
  /** Test seam: PayPal's signing certificate for local webhook verification. */
  fetchCert?: (url: string) => Promise<string>;
}

export function buildServices(
  config: Config,
  db: Db,
  logger: Logger,
  overrides: ServiceOverrides = {},
): Services {
  const now = overrides.now ?? (() => new Date());
  const audit = new AuditLogger();
  const deals = new DealStore(db, audit);
  const approvals = new ApprovalService(db, audit, now);
  const plans = new PlanService(db, audit, deals, now);
  const goals = new GoalService(db, audit, now);
  const engine = new NegotiationEngine(db, audit, deals, approvals, now);
  const events = new EventBus(db, now);
  // Sessions run on the wall clock, never a business clock override.
  const sessions = new SessionService(db);
  const ledger = new WriteLedger(now);

  let paypal: PayPalServices | null = null;
  if (config.paypal.configured) {
    const transport = overrides.paypalFetch === undefined ? {} : { fetch: overrides.paypalFetch };
    const rest = new PayPalRestClient(config.paypal, transport);
    const sdk = buildPayPalSdkClient(config.paypal, transport);
    const invoices = new InvoiceService(db, rest, ledger, audit, deals);
    const settlement = new Settlement(db, audit, deals, invoices);
    paypal = {
      rest,
      invoices,
      settlement,
      vault: new VaultService(db, sdk, ledger, audit, config.appBaseUrl),
      payments: new PaymentService(db, sdk, ledger, audit, deals, invoices, now),
      webhooks: new WebhookService(db, rest, ledger, audit, settlement, {
        webhookId: config.paypal.webhookId,
        ...(overrides.fetchCert === undefined ? {} : { fetchCert: overrides.fetchCert }),
      }),
    };
  }

  // Every audit entry reaches the businesses allowed to see it, live.
  audit.onAppend((entry, businessIds) => {
    events
      .publish(businessIds, { type: 'audit.appended', data: { entry } })
      .catch((err: unknown) => {
        logger.error({ err }, 'failed to publish audit event');
      });
  });

  /**
   * Publishes the current state of deals to their supplier and client. Callers run it after their
   * transaction commits, so screens never see a change that was rolled back.
   */
  const publishDeals = async (dealIds: readonly string[]): Promise<void> => {
    if (dealIds.length === 0) return;
    const rows = await db.deal.findMany({
      where: { id: { in: [...new Set(dealIds)] } },
      include: {
        ...dealSummaryInclude,
        plan: { select: { goal: { select: { supplierId: true } } } },
      },
    });
    for (const deal of rows) {
      await events.publish([deal.plan.goal.supplierId, deal.clientId], {
        type: 'deal.updated',
        data: { deal: dealSummary(deal) },
      });
    }
  };

  return {
    config,
    db,
    logger,
    now,
    audit,
    deals,
    approvals,
    plans,
    goals,
    engine,
    events,
    sessions,
    ledger,
    publishDeals,
    paypal,
  };
}
