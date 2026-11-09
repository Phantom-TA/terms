import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WriteLedger } from '../../src/paypal/write-ledger.js';
import { createTestDb, resetDb } from '../helpers/db.js';

const db = createTestDb();
const ledger = new WriteLedger(() => new Date('2026-11-10T10:00:00Z'));

beforeEach(async () => {
  await resetDb(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('WriteLedger (Postgres)', () => {
  it('lets exactly one of two concurrent callers claim a write', async () => {
    const input = { key: 'order:deal_1', operation: 'orders.createOrder', dealId: 'deal_1' };
    const [a, b] = await Promise.all([ledger.claim(db, input), ledger.claim(db, input)]);
    expect([a.kind, b.kind].sort()).toEqual(['claimed', 'existing']);
    expect(a.write.id).toBe(b.write.id);
    expect(a.write.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.payPalWrite.count()).toBe(1);
  });

  it('records success, keeps unknown outcomes, and releases refused writes', async () => {
    const claimed = await ledger.claim(db, { key: 'capture:O1', operation: 'orders.captureOrder' });
    const unknown = await ledger.markUnknown(db, claimed.write.id, {
      kind: 'no_response',
      status: null,
    });
    expect(unknown.status).toBe('UNKNOWN');
    expect(unknown.lastError).toEqual({ kind: 'no_response', status: null });
    expect((await ledger.unsettled(db, new Date('2026-12-01'))).map((w) => w.key)).toEqual([
      'capture:O1',
    ]);

    const done = await ledger.succeed(db, claimed.write.id, 'CAPTURE1');
    expect(done).toMatchObject({ status: 'SUCCEEDED', resultRef: 'CAPTURE1', lastError: null });
    expect(done.settledAt).toEqual(new Date('2026-11-10T10:00:00Z'));
    // A succeeded write is never released.
    await ledger.release(db, claimed.write.id);
    expect(await ledger.get(db, 'capture:O1')).not.toBeNull();

    const refused = await ledger.claim(db, {
      key: 'invoice-update:d:1',
      operation: 'invoices.update',
    });
    await ledger.release(db, refused.write.id);
    expect(await ledger.get(db, 'invoice-update:d:1')).toBeNull();
    const retry = await ledger.claim(db, {
      key: 'invoice-update:d:1',
      operation: 'invoices.update',
    });
    expect(retry.kind).toBe('claimed');
    expect(retry.write.requestId).not.toBe(refused.write.requestId);
  });

  it('surfaces any database error other than a duplicate claim', async () => {
    await expect(
      ledger.claim(db, { key: 'x'.repeat(10), operation: null as unknown as string }),
    ).rejects.toThrow();
  });
});
