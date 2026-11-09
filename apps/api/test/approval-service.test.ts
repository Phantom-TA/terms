import { ApprovalView, dollars } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService, toApprovalView } from '../src/approvals/approval-service.js';
import { AuditLogger } from '../src/audit.js';
import { DealStore } from '../src/deals/deal-store.js';
import { AppError } from '../src/errors.js';
import { createTestDb, resetDb } from './helpers/db.js';
import { type ScenarioIds, seedDeal, seedScenario } from './helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
let clock = new Date('2026-11-09T15:00:00Z');
const approvals = new ApprovalService(db, audit, () => clock);

let ids: ScenarioIds;
let dealId: string;
let planId: string;

const terms = {
  amountEarly: '1750.00',
  discountPct: '1.20',
  payBy: '2026-11-09',
  remainderDue: '2026-12-03',
};

beforeEach(async () => {
  clock = new Date('2026-11-09T15:00:00Z');
  await resetDb(db);
  ids = await seedScenario(db);
  const seeded = await seedDeal(db, ids);
  dealId = seeded.deal.id;
  planId = seeded.plan.id;
});

afterAll(async () => {
  await db.$disconnect();
});

const isAppError = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

function counterRequest(expiresAt: Date | null = null) {
  return {
    type: 'COUNTER_OVER_PLAN' as const,
    subjectType: 'DEAL' as const,
    subjectId: dealId,
    requestedFrom: 'OWNER' as const,
    businessId: ids.maya,
    visibleTo: [ids.harbor],
    title: 'Counter to Harbor & Co at 1.20%',
    summary:
      'Harbor asked for 1.50%; your maximum is 1.20%. A 1.20% counter costs $1 over your ceiling.',
    planId,
    dealId,
    terms,
    costImpact: {
      planCostBefore: '54.00',
      planCostAfter: '61.00',
      delta: '7.00',
      ceiling: '60.00',
      overCeilingBy: '1.00',
    },
    expiresAt,
    actor: 'SUPPLIER_AGENT' as const,
  };
}

describe('ApprovalService (Postgres)', () => {
  it('creates a NEEDS_OWNER approval once and shows it as a valid view', async () => {
    const a = await approvals.request(db, counterRequest());
    const again = await approvals.request(db, counterRequest());
    expect(again.id).toBe(a.id);
    const view = toApprovalView(a);
    expect(ApprovalView.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({
      type: 'COUNTER_OVER_PLAN',
      decision: 'PENDING',
      terms,
      costImpact: { overCeilingBy: '1.00' },
      paymentAmount: null,
    });
    const list = await approvals.list(db, ids.maya, { decision: 'PENDING' });
    expect(list.map((x) => x.id)).toEqual([a.id]);
    expect(await approvals.list(db, ids.harbor, {})).toEqual([]);
    // Both parties see the request in their audit trail.
    expect((await audit.list(db, ids.harbor, { limit: 5 })).entries[0]!.action).toBe(
      'APPROVAL_REQUESTED',
    );
    // The request belongs to its deal, so the Negotiation Room finds it by deal.
    const forDeal = await audit.list(db, ids.maya, { limit: 5, dealId });
    expect(forDeal.entries.map((e) => e.action)).toEqual(['APPROVAL_REQUESTED']);
  });

  it('runs the registered handler in the same transaction as the decision', async () => {
    await deals.transition({ dealId, to: 'APPROVED', actor: 'OWNER', reason: 'plan' });
    await deals.transition({ dealId, to: 'SENT', actor: 'SUPPLIER_AGENT', reason: 'offer' });
    await deals.transition({ dealId, to: 'COUNTERED', actor: 'CLIENT_AGENT', reason: '1.50%' });
    await deals.transition({
      dealId,
      to: 'NEEDS_OWNER',
      actor: 'SUPPLIER_AGENT',
      reason: 'over ceiling',
    });
    approvals.onDecision('COUNTER_OVER_PLAN', async (tx, approval) => {
      await deals.transition(
        {
          dealId: approval.dealId!,
          to: approval.decision === 'APPROVED' ? 'SENT' : 'DECLINED',
          actor: 'OWNER',
          reason: 'Owner decided the counter',
        },
        tx,
      );
    });
    const a = await approvals.request(db, counterRequest());
    const decided = await approvals.decide({
      approvalId: a.id,
      businessId: ids.maya,
      decision: 'APPROVED',
      note: 'Fine, $1 over',
      actor: 'OWNER',
    });
    expect(decided.decision).toBe('APPROVED');
    expect(decided.decisionNote).toBe('Fine, $1 over');
    expect((await deals.get(db, dealId)).state).toBe('SENT');

    await expect(
      approvals.decide({
        approvalId: a.id,
        businessId: ids.maya,
        decision: 'REJECTED',
        actor: 'OWNER',
      }),
    ).rejects.toSatisfy(isAppError('CONFLICT'));
  });

  it('rolls back the decision when its handler fails', async () => {
    approvals.onDecision('BACKUP_OVER_CEILING', () => Promise.reject(new Error('PayPal down')));
    const a = await approvals.request(db, {
      ...counterRequest(),
      type: 'BACKUP_OVER_CEILING',
      title: 'Run backup over the ceiling',
    });
    await expect(
      approvals.decide({
        approvalId: a.id,
        businessId: ids.maya,
        decision: 'APPROVED',
        actor: 'OWNER',
      }),
    ).rejects.toThrow('PayPal down');
    expect((await db.approval.findUniqueOrThrow({ where: { id: a.id } })).decision).toBe('PENDING');
  });

  it('only the addressed business can decide, and only before expiry', async () => {
    const a = await approvals.request(db, counterRequest(new Date('2026-11-09T18:00:00Z')));
    await expect(
      approvals.decide({
        approvalId: a.id,
        businessId: ids.harbor,
        decision: 'APPROVED',
        actor: 'CLIENT_HUMAN',
      }),
    ).rejects.toSatisfy(isAppError('FORBIDDEN'));
    await expect(
      approvals.decide({
        approvalId: 'nope',
        businessId: ids.maya,
        decision: 'APPROVED',
        actor: 'OWNER',
      }),
    ).rejects.toSatisfy(isAppError('NOT_FOUND'));
    clock = new Date('2026-11-09T18:00:01Z');
    await expect(
      approvals.decide({
        approvalId: a.id,
        businessId: ids.maya,
        decision: 'APPROVED',
        actor: 'OWNER',
      }),
    ).rejects.toThrow('Approval expired');
    expect((await db.approval.findUniqueOrThrow({ where: { id: a.id } })).decision).toBe('EXPIRED');
  });

  it('expires and withdraws pending approvals', async () => {
    await approvals.request(db, counterRequest(new Date('2026-11-09T16:00:00Z')));
    const payment = await approvals.request(db, {
      ...counterRequest(),
      type: 'CLIENT_PAYMENT',
      requestedFrom: 'CLIENT_HUMAN',
      businessId: ids.harbor,
      visibleTo: [ids.maya],
      title: 'Approve $1,729.00 to Maya Studio',
      paymentAmountCents: dollars(1729),
      costImpact: null,
      terms: null,
    });
    expect(toApprovalView(payment)).toMatchObject({ paymentAmount: '1729.00', terms: null });
    clock = new Date('2026-11-09T17:00:00Z');
    expect(await approvals.expireDue()).toBe(1);
    await approvals.withdraw(db, payment.id, 'Goal met');
    await approvals.withdraw(db, payment.id, 'Goal met'); // idempotent
    const row = await db.approval.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row).toMatchObject({ decision: 'WITHDRAWN', decisionNote: 'Goal met' });
    expect(await approvals.list(db, ids.harbor, { type: 'CLIENT_PAYMENT' })).toHaveLength(1);
  });
});
