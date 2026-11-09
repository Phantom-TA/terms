/**
 * The PayPal write ledger (paypal-plan.md, "Durable writes"). Every PayPal write is claimed here
 * before it is sent: claim → call → record. The claim's `key` is computed the same way by every
 * caller doing the same operation, so the unique constraint stops a second caller before it reaches
 * PayPal; the claim's `requestId` travels as PayPal-Request-Id, which PayPal deduplicates on.
 */
import { randomUUID } from 'node:crypto';
import { type DbOrTx } from '../db.js';
import { Prisma, type PayPalWrite } from '../generated/prisma/client.js';
import { toAuditJson } from '../mappers.js';

export interface ClaimInput {
  /** Deterministic for the operation, e.g. `order:{dealId}`. */
  key: string;
  /** What is being written, e.g. `orders.createOrder`. */
  operation: string;
  dealId?: string | null;
}

export type Claim =
  /** This caller owns the write and must make the call. */
  | { kind: 'claimed'; write: PayPalWrite }
  /** Another caller already claimed it; use its row (and settle it if it is UNKNOWN). */
  | { kind: 'existing'; write: PayPalWrite };

/** Diagnostic stored on an UNKNOWN write. Never a body, a header value or a secret. */
export interface WriteDiagnostic {
  kind: string;
  status?: number | null;
  debugId?: string | null;
  message?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export class WriteLedger {
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Claims a write. Runs outside any transaction the caller holds open, so the claim commits. */
  async claim(db: DbOrTx, input: ClaimInput): Promise<Claim> {
    try {
      const write = await db.payPalWrite.create({
        data: {
          key: input.key,
          operation: input.operation,
          requestId: randomUUID(),
          dealId: input.dealId ?? null,
        },
      });
      return { kind: 'claimed', write };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const write = await db.payPalWrite.findUniqueOrThrow({ where: { key: input.key } });
      return { kind: 'existing', write };
    }
  }

  /** Records that PayPal acted; `resultRef` is the id of what it created or changed. */
  async succeed(db: DbOrTx, id: string, resultRef: string | null): Promise<PayPalWrite> {
    return db.payPalWrite.update({
      where: { id },
      data: { status: 'SUCCEEDED', resultRef, settledAt: this.now(), lastError: Prisma.DbNull },
    });
  }

  /** PayPal may have acted and Terms could not learn the answer. Kept for a re-read. */
  async markUnknown(db: DbOrTx, id: string, diagnostic: WriteDiagnostic): Promise<PayPalWrite> {
    return db.payPalWrite.update({
      where: { id },
      data: {
        status: 'UNKNOWN',
        lastError: toAuditJson({ ...diagnostic }) as Prisma.InputJsonObject,
      },
    });
  }

  /**
   * Releases a claim whose call never took effect: PayPal refused it, or it was never sent. A later,
   * corrected attempt can then claim the same key.
   */
  async release(db: DbOrTx, id: string): Promise<void> {
    await db.payPalWrite.deleteMany({ where: { id, status: { not: 'SUCCEEDED' } } });
  }

  async get(db: DbOrTx, key: string): Promise<PayPalWrite | null> {
    return db.payPalWrite.findUnique({ where: { key } });
  }

  /** Writes left UNKNOWN (or CLAIMED by a process that died), oldest first, for reconciliation. */
  async unsettled(db: DbOrTx, olderThan: Date): Promise<PayPalWrite[]> {
    return db.payPalWrite.findMany({
      where: { status: { in: ['UNKNOWN', 'CLAIMED'] }, createdAt: { lte: olderThan } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
