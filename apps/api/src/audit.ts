/**
 * The audit trail (CONTEXT.md principle 7): who or what proposed each step, the policy checks
 * run, who approved, PayPal request and debug IDs, and the webhook that confirmed it. Entries are
 * append-only and scrubbed of secrets before they are stored.
 */
import {
  type Actor,
  type AuditAction,
  type AuditEntry,
  type ListAuditQuery,
  type ListAuditResponse,
  type SubjectType,
} from '@terms/shared';
import { type DbOrTx } from './db.js';
import { type AuditLog, type Prisma } from './generated/prisma/client.js';
import { toAuditJson } from './mappers.js';

export interface AuditInput {
  actor: Actor;
  action: AuditAction;
  subjectType: SubjectType;
  subjectId: string;
  /** Businesses allowed to see the entry (always the supplier; the client for its deals). */
  businessIds: readonly string[];
  summary: string;
  details?: Record<string, unknown>;
  paypalDebugId?: string | null;
  paypalRequestId?: string | null;
  webhookVerified?: boolean | null;
}

/** Listener notified after an entry is written (used to publish `audit.appended` events). */
export type AuditListener = (entry: AuditEntry, businessIds: readonly string[]) => void;

export function toAuditEntry(row: AuditLog): AuditEntry {
  const details = row.details;
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: row.actor,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    summary: row.summary,
    details:
      details !== null && typeof details === 'object' && !Array.isArray(details) ? details : {},
    paypalDebugId: row.paypalDebugId,
    paypalRequestId: row.paypalRequestId,
    webhookVerified: row.webhookVerified,
  };
}

export class AuditLogger {
  private readonly listeners = new Set<AuditListener>();

  onAppend(listener: AuditListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes one entry. Pass a transaction client to make the entry part of the same commit. */
  async write(db: DbOrTx, input: AuditInput): Promise<AuditEntry> {
    const row = await db.auditLog.create({
      data: {
        actor: input.actor,
        action: input.action,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        businessIds: [...new Set(input.businessIds)],
        summary: input.summary,
        details: toAuditJson(input.details ?? {}) as Prisma.InputJsonObject,
        paypalDebugId: input.paypalDebugId ?? null,
        paypalRequestId: input.paypalRequestId ?? null,
        webhookVerified: input.webhookVerified ?? null,
      },
    });
    const entry = toAuditEntry(row);
    for (const listener of this.listeners) listener(entry, row.businessIds);
    return entry;
  }

  /** Entries visible to a business, newest first, with cursor pagination. */
  async list(db: DbOrTx, businessId: string, query: ListAuditQuery): Promise<ListAuditResponse> {
    const where: Prisma.AuditLogWhereInput = {
      businessIds: { has: businessId },
      ...(query.subjectType === undefined ? {} : { subjectType: query.subjectType }),
      ...(query.subjectId === undefined ? {} : { subjectId: query.subjectId }),
      ...(query.actor === undefined ? {} : { actor: query.actor }),
      ...(query.action === undefined ? {} : { action: query.action }),
    };
    const rows = await db.auditLog.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      entries: page.map(toAuditEntry),
      nextCursor: rows.length > query.limit && last !== undefined ? last.id : null,
    };
  }
}
