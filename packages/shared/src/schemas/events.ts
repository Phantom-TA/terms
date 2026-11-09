/**
 * Server-sent events on GET /api/stream. Each SSE frame has `event: <type>` and `data: <JSON of
 * the whole ServerEvent>`, and `id: <event id>` so a reconnecting EventSource resumes with
 * Last-Event-ID. Each session receives only events about its own business's records.
 */
import { z } from 'zod';
import { PlanStatus } from '../enums.js';
import { Id, IsoDateTime, MoneyAmount } from './common.js';
import { ApprovalView } from './approvals.js';
import { AuditEntry } from './audit.js';
import { DealSummary } from './deals.js';
import { InvoiceRow } from './invoices.js';
import { NegotiationMessage } from './negotiation.js';
import { PlanSummary } from './plans.js';
import { RunwayResponse } from './runway.js';
import { SyncResponse } from './sync.js';

function event<T extends string, D extends z.ZodType>(type: T, data: D) {
  return z.object({
    id: z.string().min(1),
    type: z.literal(type),
    at: IsoDateTime,
    data,
  });
}

export const ServerEvent = z.discriminatedUnion('type', [
  /** An invoice changed (sync, webhook, plan or deal change). Replace the Workbench row. */
  event('invoice.updated', z.object({ invoice: InvoiceRow })),
  /** Plan status or totals changed. Update the top rail. */
  event('plan.updated', z.object({ planId: Id, status: PlanStatus, summary: PlanSummary })),
  /** A deal changed state or terms. */
  event('deal.updated', z.object({ deal: DealSummary })),
  /** A negotiation message was stored (and delivered). Append to the Negotiation Room. */
  event('negotiation.message', z.object({ message: NegotiationMessage })),
  /** A new approval is waiting (plan, NEEDS_OWNER, backup over ceiling, client payment). */
  event('approval.requested', z.object({ approval: ApprovalView })),
  /** An approval was decided, expired or withdrawn. */
  event('approval.decided', z.object({ approval: ApprovalView })),
  /** Committed cash reached the target; unneeded offers were withdrawn. */
  event(
    'goal.met',
    z.object({
      goalId: Id,
      planId: Id,
      target: MoneyAmount,
      committed: MoneyAmount,
      cost: MoneyAmount,
      withdrawnDealIds: z.array(Id),
    }),
  ),
  /** The runway changed (payment confirmed, deal agreed or expired). */
  event('runway.updated', z.object({ runway: RunwayResponse })),
  /** A PayPal webhook arrived; `verified` is the signature-verification result. */
  event(
    'webhook.received',
    z.object({
      paypalEventId: z.string(),
      eventType: z.string(),
      verified: z.boolean(),
      duplicate: z.boolean(),
    }),
  ),
  /** An audit entry was written. */
  event('audit.appended', z.object({ entry: AuditEntry })),
  /** A PayPal sync finished. */
  event('sync.completed', z.object({ sync: SyncResponse })),
  /** Keep-alive, every 20 seconds. */
  event('heartbeat', z.object({})),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
export type ServerEventType = ServerEvent['type'];
export type ServerEventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>;

export const SERVER_EVENT_TYPES = ServerEvent.options.map(
  (o) => o.shape.type.value,
) as readonly ServerEventType[];

export const HEARTBEAT_INTERVAL_MS = 20_000;
