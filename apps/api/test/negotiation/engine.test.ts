import { CostImpact, dollars, NegotiationTerms } from '@terms/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from '../../src/approvals/approval-service.js';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { AppError } from '../../src/errors.js';
import { isoToDate } from '../../src/mappers.js';
import { NegotiationEngine, OFFER_TTL_MS } from '../../src/negotiation/engine.js';
import { deterministicMovers, type Movers } from '../../src/negotiation/simulator.js';
import { PlanService } from '../../src/plans/plan-service.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { FRIDAY, type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
let clock = new Date('2026-11-09T15:00:00Z'); // 10:00 Monday in New York
const now = () => clock;
const plans = new PlanService(db, audit, deals, now);

let ids: ScenarioIds;

function engineWith(movers: Movers = deterministicMovers) {
  const approvals = new ApprovalService(db, audit, now);
  return { engine: new NegotiationEngine(db, audit, deals, approvals, now, movers), approvals };
}

/** The demo: goal, planned and approved with Maya's $60 ceiling. Returns the deal ids by invoice. */
async function approvedDemoPlan() {
  const goal = await db.goal.create({
    data: {
      supplierId: ids.maya,
      rawText:
        "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.",
      amountCents: dollars(6200),
      deadline: isoToDate(FRIDAY),
      maxDiscountBps: 120,
      openingDiscountBps: 80,
      doNotContactIds: [ids.pinecrest, ids.birch],
      bufferBps: 500,
    },
  });
  const planId = await plans.createPlan(goal.id);
  await plans.approve(planId, ids.maya, dollars(60));
  const rows = await db.deal.findMany({ where: { planId }, include: { invoice: true } });
  const byNumber = Object.fromEntries(rows.map((d) => [d.invoice.number, d.id]));
  return { planId, juniper: byNumber['1041']!, harbor: byNumber['1043']!, oak: byNumber['1038']! };
}

beforeEach(async () => {
  clock = new Date('2026-11-09T15:00:00Z');
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

const isAppError = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

describe('NegotiationEngine on the CONTEXT.md demo (Postgres)', () => {
  it('plays the whole demo: Juniper agrees, Harbor needs the owner, the owner approves, Harbor agrees', async () => {
    const { engine, approvals } = engineWith();
    const demo = await approvedDemoPlan();

    // Juniper's agent accepts 0.8%; $4,960 is above its $3,000 limit, so its person must approve.
    const juniper = await engine.runAgents(demo.juniper);
    expect(juniper).toMatchObject({
      state: 'AGREED',
      costCents: dollars(40),
      committedCents: dollars(4960),
    });
    const juniperApproval = await db.approval.findFirstOrThrow({
      where: { dealId: demo.juniper, type: 'CLIENT_PAYMENT' },
    });
    expect(juniperApproval).toMatchObject({
      requestedFrom: 'CLIENT_HUMAN',
      businessId: ids.juniper,
      paymentAmountCents: dollars(4960),
      decision: 'PENDING',
    });

    // Harbor's agent counters 0.8% at 1.5%; Maya's agent can only go to 1.2%, $1 over the ceiling.
    const harbor = await engine.runAgents(demo.harbor);
    expect(harbor.state).toBe('NEEDS_OWNER');
    const ownerAsk = await db.approval.findFirstOrThrow({
      where: { dealId: demo.harbor, type: 'COUNTER_OVER_PLAN' },
    });
    expect(ownerAsk).toMatchObject({
      requestedFrom: 'OWNER',
      businessId: ids.maya,
      title: 'Counter Harbor & Co at 1.20%',
    });
    expect(NegotiationTerms.parse(ownerAsk.terms)).toMatchObject({
      amountEarly: '1750.00',
      discountPct: '1.20',
    });
    expect(CostImpact.parse(ownerAsk.costImpact)).toEqual({
      planCostBefore: '54.00',
      planCostAfter: '61.00',
      delta: '7.00',
      ceiling: '60.00',
      overCeilingBy: '1.00',
    });

    // Maya approves; the 1.2% counter goes out as round 3 and Harbor's agent accepts (18.5% a year).
    await approvals.decide({
      approvalId: ownerAsk.id,
      businessId: ids.maya,
      decision: 'APPROVED',
      actor: 'OWNER',
    });
    expect((await deals.get(db, demo.harbor)).state).toBe('SENT');
    const agreed = await engine.runAgents(demo.harbor);
    expect(agreed).toMatchObject({
      state: 'AGREED',
      round: 3,
      costCents: dollars(21),
      committedCents: dollars(1729),
    });
    // $1,729 is within Harbor's $2,000 limit: no person needed.
    expect(
      await db.approval.count({ where: { dealId: demo.harbor, type: 'CLIENT_PAYMENT' } }),
    ).toBe(0);

    // The transcript, stored before delivery, in order.
    const transcript = await db.negotiationMessage.findMany({
      where: { dealId: demo.harbor },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      transcript.map((m) => `${m.round}:${m.actor}:${m.type}:${m.impliedAnnualRate ?? '-'}`),
    ).toEqual([
      '1:SUPPLIER_AGENT:OFFER:12.3',
      '2:CLIENT_AGENT:COUNTER:23.2', // 1.5% is the 23% target rounded to 0.1%
      '3:OWNER:COUNTER:18.5',
      '3:CLIENT_AGENT:ACCEPT:18.5',
    ]);
    expect(transcript[0]!.fromParty).toBe('supplier:maya-studio');
    expect(transcript[0]!.toParty).toBe('client:harbor-co');
    expect(transcript[3]!.payNowCents).toBe(dollars(1729));

    // The plan now commits $6,689 against the $6,510 target, for $61: the goal is met.
    const view = await plans.getView(demo.planId, ids.maya);
    expect(view.summary).toMatchObject({ committed: '6689.00', costSoFar: '61.00', goalMet: true });

    // Both businesses see the negotiation in their audit trail.
    const harborTrail = await audit.list(db, ids.harbor, { limit: 50, dealId: demo.harbor });
    expect(harborTrail.entries.filter((e) => e.action === 'NEGOTIATION_MESSAGE')).toHaveLength(4);
  });

  it('declines when the owner says no to going over the plan', async () => {
    const { engine, approvals } = engineWith();
    const demo = await approvedDemoPlan();
    await engine.runAgents(demo.harbor);
    const ask = await db.approval.findFirstOrThrow({
      where: { dealId: demo.harbor, type: 'COUNTER_OVER_PLAN' },
    });
    await approvals.decide({
      approvalId: ask.id,
      businessId: ids.maya,
      decision: 'REJECTED',
      actor: 'OWNER',
    });
    const deal = await deals.get(db, demo.harbor);
    expect(deal).toMatchObject({
      state: 'DECLINED',
      closedReason: 'The owner declined to go over the plan',
    });
  });

  it('accepts on the owner’s yes when the prepared move is an accept', async () => {
    // Harbor asks 1.1% (within d_max), but the ceiling is lowered so accepting needs the owner.
    const movers: Movers = {
      ...deterministicMovers,
      client: (view, offer, round) =>
        round === 1
          ? {
              type: 'COUNTER',
              terms: { ...offer, discountBps: 110 },
              reason: 'ask 1.1%',
              checks: [],
            }
          : deterministicMovers.client(view, offer, round),
    };
    const { engine, approvals } = engineWith(movers);
    const demo = await approvedDemoPlan();
    await db.plan.update({ where: { id: demo.planId }, data: { costCeilingCents: dollars(55) } });
    expect((await engine.runAgents(demo.harbor)).state).toBe('NEEDS_OWNER');
    const ask = await db.approval.findFirstOrThrow({
      where: { dealId: demo.harbor, type: 'COUNTER_OVER_PLAN' },
    });
    expect(ask.title).toBe('Accept Harbor & Co at 1.10%');
    await approvals.decide({
      approvalId: ask.id,
      businessId: ids.maya,
      decision: 'APPROVED',
      actor: 'OWNER',
    });
    expect(await deals.get(db, demo.harbor)).toMatchObject({ state: 'AGREED', round: 2 });
  });
});

describe('NegotiationEngine guards every move (as it will an LLM’s)', () => {
  it('refuses a supplier move above the maximum discount and persists nothing', async () => {
    const reckless: Movers = {
      ...deterministicMovers,
      supplier: (_view, counter) => ({ type: 'ACCEPT', terms: counter, checks: [] }),
    };
    const { engine } = engineWith(reckless);
    const demo = await approvedDemoPlan();
    await engine.sendOffer(demo.harbor);
    await engine.clientTurn(demo.harbor); // Harbor counters at 1.5%
    await expect(engine.supplierTurn(demo.harbor)).rejects.toSatisfy(
      (e) =>
        e instanceof AppError &&
        e.code === 'POLICY_BLOCKED' &&
        e.policyChecks?.some((c) => c.rule === 'maxDiscount' && c.result === 'blocked') === true,
    );
    expect((await deals.get(db, demo.harbor)).state).toBe('COUNTERED');
    expect(await db.negotiationMessage.count({ where: { dealId: demo.harbor } })).toBe(2);
  });

  it('refuses a supplier move over the ceiling that does not ask the owner', async () => {
    const sneaky: Movers = {
      ...deterministicMovers,
      supplier: (_view, counter) => ({
        type: 'COUNTER',
        terms: { ...counter, discountBps: 120 },
        reason: 'over the ceiling quietly',
        checks: [],
      }),
    };
    const { engine } = engineWith(sneaky);
    const demo = await approvedDemoPlan();
    await engine.sendOffer(demo.harbor);
    await engine.clientTurn(demo.harbor);
    await expect(engine.supplierTurn(demo.harbor)).rejects.toSatisfy(isAppError('POLICY_BLOCKED'));
  });

  it('refuses client moves that break the client’s own policy or change the offer', async () => {
    const accepts = (amount: bigint): Movers => ({
      ...deterministicMovers,
      client: (_v, offer) => ({
        type: 'ACCEPT',
        terms: { ...offer, amountEarly: amount },
        payment: 0n,
        needsHumanApproval: false,
        checks: [],
      }),
    });
    const changed = engineWith(accepts(dollars(1700)));
    const demo = await approvedDemoPlan();
    await changed.engine.sendOffer(demo.harbor);
    await expect(changed.engine.clientTurn(demo.harbor)).rejects.toSatisfy(
      isAppError('POLICY_BLOCKED'),
    );
    // Accepting 0.8% as offered is below Harbor's 15% hurdle: blocked too.
    const below = engineWith(accepts(dollars(1750)));
    await expect(below.engine.clientTurn(demo.harbor)).rejects.toSatisfy(
      isAppError('POLICY_BLOCKED'),
    );
    const greedy: Movers = {
      ...deterministicMovers,
      client: (_v, offer) => ({
        type: 'COUNTER',
        terms: { ...offer, amountEarly: dollars(9000) },
        reason: 'all',
        checks: [],
      }),
    };
    await expect(engineWith(greedy).engine.clientTurn(demo.harbor)).rejects.toSatisfy(
      isAppError('POLICY_BLOCKED'),
    );
    expect((await deals.get(db, demo.harbor)).state).toBe('SENT');
  });

  it('refuses a NEEDS_OWNER that is not over the ceiling', async () => {
    const needy: Movers = {
      ...deterministicMovers,
      supplier: (_view, counter) => ({
        type: 'NEEDS_OWNER',
        terms: { ...counter, discountBps: 80 },
        onApproval: 'COUNTER',
        overCeilingBy: 0n,
        reason: 'not needed',
        checks: [],
      }),
    };
    const { engine } = engineWith(needy);
    const demo = await approvedDemoPlan();
    await engine.sendOffer(demo.harbor);
    await engine.clientTurn(demo.harbor);
    await expect(engine.supplierTurn(demo.harbor)).rejects.toSatisfy(isAppError('POLICY_BLOCKED'));
  });
});

describe('NegotiationEngine edges', () => {
  it('stops at SENT for a client without an agent, and refuses turns out of order', async () => {
    const { engine } = engineWith();
    await db.business.update({ where: { id: ids.harbor }, data: { hasAgent: false } });
    const demo = await approvedDemoPlan();
    // A human client's row is a partial-payment offer; it is sent but answered on the offer page.
    await engine.sendOffer(demo.harbor);
    expect((await engine.runAgents(demo.harbor)).state).toBe('SENT');
    await expect(engine.clientTurn(demo.harbor)).rejects.toSatisfy(isAppError('CONFLICT'));
    await expect(engine.supplierTurn(demo.harbor)).rejects.toSatisfy(isAppError('CONFLICT'));
    await expect(engine.sendOffer(demo.harbor)).rejects.toSatisfy(isAppError('CONFLICT'));
    await expect(engine.sendOffer(demo.oak)).rejects.toSatisfy(isAppError('CONFLICT'));
    await expect(engine.sendOffer('missing')).rejects.toSatisfy(isAppError('NOT_FOUND'));
  });

  it('expires offers that were not answered in time', async () => {
    const { engine } = engineWith();
    const demo = await approvedDemoPlan();
    await engine.sendOffer(demo.juniper);
    await engine.sendOffer(demo.harbor);
    clock = new Date(clock.getTime() + OFFER_TTL_MS + 1);
    // A late answer finds the offer expired.
    expect((await engine.clientTurn(demo.juniper)).state).toBe('EXPIRED');
    expect(await engine.expireDue()).toBe(1);
    expect((await deals.get(db, demo.harbor)).state).toBe('EXPIRED');
  });

  it('declines when the client never pays this supplier early', async () => {
    await db.clientPolicy.update({
      where: { businessId: ids.juniper },
      data: { neverPayEarly: [ids.maya] },
    });
    const { engine } = engineWith();
    const demo = await approvedDemoPlan();
    const deal = await engine.runAgents(demo.juniper);
    expect(deal).toMatchObject({
      state: 'DECLINED',
      closedReason: 'This supplier is never paid early',
    });
  });

  it('refuses a plan offer that no longer passes policy', async () => {
    const { engine } = engineWith();
    const demo = await approvedDemoPlan();
    // The client moved onto the do-not-contact list after approval.
    await db.supplierPolicy.update({
      where: { businessId: ids.maya },
      data: { doNotContact: [ids.juniper] },
    });
    await expect(engine.sendOffer(demo.juniper)).rejects.toSatisfy(isAppError('POLICY_BLOCKED'));
  });
});
