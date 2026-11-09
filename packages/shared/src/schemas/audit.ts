import { z } from 'zod';
import { Actor, AuditAction, SubjectType } from '../enums.js';
import { Id, IsoDateTime } from './common.js';

/** One audit trail entry. Never contains secrets or tokens. */
export const AuditEntry = z.object({
  id: Id,
  at: IsoDateTime,
  actor: Actor,
  action: AuditAction,
  subjectType: SubjectType,
  subjectId: z.string(),
  /** One plain-language line, e.g. "Policy blocked 1.50%: above the 1.20% maximum". */
  summary: z.string(),
  /** Structured details: policy checks, terms, PayPal request IDs, webhook IDs. */
  details: z.record(z.string(), z.unknown()),
  paypalDebugId: z.string().nullable(),
  /** PayPal-Request-Id sent with the write (idempotency key). */
  paypalRequestId: z.string().nullable(),
  /** For webhook entries: whether PayPal's signature verification passed. */
  webhookVerified: z.boolean().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** GET /api/audit — newest first. Each business sees entries about its own records. */
export const ListAuditQuery = z.object({
  subjectType: SubjectType.optional(),
  subjectId: z.string().min(1).optional(),
  actor: Actor.optional(),
  action: AuditAction.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAuditQuery = z.infer<typeof ListAuditQuery>;

export const ListAuditResponse = z.object({
  entries: z.array(AuditEntry),
  /** Pass as `cursor` to fetch older entries; null at the end. */
  nextCursor: z.string().nullable(),
});
export type ListAuditResponse = z.infer<typeof ListAuditResponse>;
