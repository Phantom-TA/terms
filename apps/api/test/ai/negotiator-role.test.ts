import { dollars, meetsAnnualRate } from '@terms/shared';
import fc from 'fast-check';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AiMovers,
  type ClientAnswer,
  clientMoveFrom,
  type FallbackReport,
  type SupplierAnswer,
  supplierMoveFrom,
} from '../../src/ai/negotiator-role.js';
import { AiRoleError } from '../../src/ai/runner.js';
import { ApprovalService } from '../../src/approvals/approval-service.js';
import { AuditLogger } from '../../src/audit.js';
import { DealStore } from '../../src/deals/deal-store.js';
import { NegotiationEngine, wireToTerms } from '../../src/negotiation/engine.js';
import type { ClientView, SupplierView, Terms } from '../../src/negotiation/strategies.js';
import { PlanService } from '../../src/plans/plan-service.js';
import { ScriptedRunner } from '../helpers/ai.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { approvedDemoPlan } from '../helpers/demo-plan.js';
import { type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
const audit = new AuditLogger();
const deals = new DealStore(db, audit);
const now = () => new Date('2026-11-09T15:00:00Z'); // 10:00 Monday in New York
const plans = new PlanService(db, audit, deals, now);
let ids: ScenarioIds;

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

function engineWith(runner: ScriptedRunner) {
  const reports: FallbackReport[] = [];
  const approvals = new ApprovalService(db, audit, now);
  const movers = new AiMovers(runner, (r) => reports.push(r));
  return {
    engine: new NegotiationEngine(db, audit, deals, approvals, now, movers),
    reports,
    approvals,
  };
}

const clientSays = (over: Partial<ClientAnswer> = {}): ClientAnswer => ({
  move: 'COUNTER',
  discountPct: '1.50',
  amountEarly: null,
  reason: 'Our target is 23% a year.',
  ...over,
});
const supplierSays = (over: Partial<SupplierAnswer> = {}): SupplierAnswer => ({
  move: 'COUNTER',
  discountPct: '1.20',
  reason: 'Our maximum is 1.2%.',
  ...over,
});

/** A model that plays the demo the way the standard strategies do. */
const demoModel = () =>
  new ScriptedRunner((call) => {
    if (call.role === 'client-negotiator') {
      // Harbor counters 1.5% on the first offer, then accepts what it is offered next.
      return call.prompt.includes('Round 1 of') && call.prompt.includes('by 2026-11-09 at 0.80%')
        ? call.prompt.includes('$1,750.00')
          ? clientSays()
          : clientSays({ move: 'ACCEPT', discountPct: null, reason: 'Fine.' })
        : clientSays({ move: 'ACCEPT', discountPct: null, reason: 'Fine.' });
    }
    return supplierSays();
  });

describe('AiMovers on the demo', () => {
  it('plays it like the standard strategies, with each side seeing only its own policy', async () => {
    const runner = demoModel();
    const { engine, reports } = engineWith(runner);
    const demo = await approvedDemoPlan(db, ids, plans);

    expect((await engine.runAgents(demo.juniper)).state).toBe('AGREED');
    const harbor = await engine.runAgents(demo.harbor);
    expect(harbor.state).toBe('NEEDS_OWNER');
    expect(reports).toEqual([]);

    const ask = await db.approval.findFirstOrThrow({
      where: { dealId: demo.harbor, type: 'COUNTER_OVER_PLAN' },
    });
    expect(ask).toMatchObject({ title: 'Counter Harbor & Co at 1.20%' });
    // The reason the owner reads is the model's, with the ceiling arithmetic added by code.
    const asked = await db.dealTransition.findFirstOrThrow({
      where: { dealId: demo.harbor, toState: 'NEEDS_OWNER' },
    });
    expect(asked.privateReason).toBe('Our maximum is 1.2%. (costs $1.00 over the $60.00 ceiling)');

    // The client's model never sees the supplier's ceiling or plan; the supplier's never sees the
    // client's hurdle, target, cash or approval limit.
    for (const call of runner.callsTo('client-negotiator')) {
      expect(call.prompt + call.system).not.toMatch(/ceiling|plan allowed|owner policy|maximum/i);
      expect(call.prompt).toContain('Your company policy');
    }
    for (const call of runner.callsTo('supplier-negotiator')) {
      expect(call.prompt + call.system).not.toMatch(
        /hurdle|target|auto-pay|buffer|a year|payables/i,
      );
      // Harbor's own figures: buffer, cash on hand, early-pay cap, approval limit.
      expect(call.prompt).not.toMatch(/\$20,000\.00|\$60,000\.00|\$5,000\.00|\$2,000\.00/);
      expect(call.prompt).toContain('Owner policy');
    }
    // Both are told the standard strategy's move, as the reference they may depart from.
    expect(runner.callsTo('supplier-negotiator')[0]?.prompt).toContain(
      'The standard strategy would: ask the owner (counter at 1.20%).',
    );
  });
});

describe('AiMovers falls back to the standard move', () => {
  it('when the model proposes something the client’s own policy forbids', async () => {
    // Juniper's hurdle is raised so no offer can meet it; the model accepts anyway.
    const runner = new ScriptedRunner(() => clientSays({ move: 'ACCEPT', discountPct: null }));
    const { engine, reports } = engineWith(runner);
    await db.clientPolicy.update({ where: { businessId: ids.juniper }, data: { hurdleBps: 9000 } });
    const demo = await approvedDemoPlan(db, ids, plans);
    const juniper = await engine.runAgents(demo.juniper);
    // The model's accept never lands: the standard strategy answers instead.
    expect(juniper.state).not.toBe('AGREED');
    expect(reports[0]).toEqual({ side: 'client', why: 'policy' });
  });

  it('when the supplier’s model offers more than the owner’s maximum', async () => {
    const runner = new ScriptedRunner((call) =>
      call.role === 'client-negotiator'
        ? clientSays()
        : supplierSays({ move: 'ACCEPT', discountPct: null }),
    );
    const { engine, reports } = engineWith(runner);
    const demo = await approvedDemoPlan(db, ids, plans);
    // Harbor asks 1.5%; accepting it would break the 1.2% maximum. The standard move is used.
    expect((await engine.runAgents(demo.harbor)).state).toBe('NEEDS_OWNER');
    expect(reports).toEqual([{ side: 'supplier', why: 'policy' }]);
    const transcript = await db.negotiationMessage.findMany({ where: { dealId: demo.harbor } });
    expect(transcript.every((m) => m.type !== 'ACCEPT')).toBe(true);
  });

  it('when the provider fails, or the answer does not fit', async () => {
    for (const failure of ['provider', 'timeout', 'invalid'] as const) {
      await resetDb(db);
      ids = await seedScenario(db);
      const runner = new ScriptedRunner(
        (call) => new AiRoleError(failure, call.role, 'unavailable'),
      );
      const { engine, reports } = engineWith(runner);
      const demo = await approvedDemoPlan(db, ids, plans);
      // The standard strategies' result.
      expect((await engine.runAgents(demo.harbor)).state).toBe('NEEDS_OWNER');
      expect(reports.map((r) => r.why)).toEqual([failure, failure]);
    }
  });

  it('but does not hide a bug: an error that is not the model’s is raised', async () => {
    const runner = new ScriptedRunner(() => new Error('database exploded'));
    const { engine } = engineWith(runner);
    const demo = await approvedDemoPlan(db, ids, plans);
    await engine.sendOffer(demo.harbor);
    await expect(engine.clientTurn(demo.harbor)).rejects.toThrow('database exploded');
  });
});

const clientView: ClientView = {
  supplierId: 'supplier-1',
  invoiceDue: dollars(7500),
  dueDate: '2026-12-04',
  cashAvailable: dollars(60000),
  policy: {
    hurdleBps: 1500,
    targetBps: 2300,
    cashBuffer: dollars(20000),
    autoPayLimit: dollars(2000),
    earlyPayCap: dollars(5000),
    neverPayEarly: [],
  },
};
const offer: Terms = {
  amountEarly: dollars(1750),
  discountBps: 80,
  payBy: '2026-11-09',
  remainderDue: '2026-12-04',
};
const supplierView: SupplierView = {
  clientId: 'client-1',
  doNotContact: [],
  maxBps: 120,
  planBps: 80,
  ceiling: dollars(60),
  otherRowsCost: dollars(40),
  invoiceDue: dollars(7500),
  dueDate: '2026-12-04',
  today: '2026-11-09',
};
const counter: Terms = { ...offer, discountBps: 150 };

describe('an answer that is malformed is refused before it can become a move', () => {
  it('client: a counter must ask for at least the discount offered, no more money, in steps', () => {
    const bad: Partial<ClientAnswer>[] = [
      { discountPct: null },
      { discountPct: '0.50' }, // less than offered
      { discountPct: '1.55' }, // not a 0.1% step
      { discountPct: '1.50', amountEarly: '2000.00' }, // more than offered
      { discountPct: '1.50', amountEarly: '300.00' }, // not a $250 step
      { discountPct: '1.50', amountEarly: '0.00' },
    ];
    for (const over of bad) {
      expect(
        () => clientMoveFrom(clientSays(over), clientView, offer, 1),
        JSON.stringify(over),
      ).toThrow(AiRoleError);
    }
    const ok = clientMoveFrom(clientSays({ amountEarly: '1000.00' }), clientView, offer, 1);
    expect(ok).toMatchObject({
      type: 'COUNTER',
      terms: { amountEarly: dollars(1000), discountBps: 150, remainderDue: '2026-12-04' },
    });
  });

  it('client: accept and decline become the standard shapes', () => {
    expect(
      clientMoveFrom(clientSays({ move: 'ACCEPT', discountPct: null }), clientView, offer, 1),
    ).toMatchObject({
      type: 'ACCEPT',
      terms: offer,
      payment: dollars(1736),
      needsHumanApproval: false,
    });
    expect(
      clientMoveFrom(clientSays({ move: 'DECLINE', discountPct: null }), clientView, offer, 1),
    ).toMatchObject({ type: 'DECLINE' });
    const big = { ...offer, amountEarly: dollars(4000) };
    expect(
      clientMoveFrom(clientSays({ move: 'ACCEPT', discountPct: null }), clientView, big, 1),
    ).toMatchObject({ needsHumanApproval: true });
  });

  it('supplier: a counter must offer less than the client asked for, in steps', () => {
    for (const over of [
      { discountPct: null },
      { discountPct: '1.50' },
      { discountPct: '1.60' },
      { discountPct: '1.15' },
    ]) {
      expect(
        () => supplierMoveFrom(supplierSays(over), supplierView, counter, 2),
        JSON.stringify(over),
      ).toThrow(AiRoleError);
    }
  });

  it('supplier: a move over the ceiling becomes a request to the owner, with the arithmetic in the reason', () => {
    const move = supplierMoveFrom(supplierSays(), supplierView, counter, 2);
    expect(move).toMatchObject({
      type: 'NEEDS_OWNER',
      onApproval: 'COUNTER',
      overCeilingBy: dollars(1),
    });
    const accept = supplierMoveFrom(
      supplierSays({ move: 'ACCEPT', discountPct: null }),
      { ...supplierView, maxBps: 200 },
      counter,
      2,
    );
    expect(accept).toMatchObject({ type: 'NEEDS_OWNER', onApproval: 'ACCEPT' });
    expect(
      supplierMoveFrom(
        supplierSays({ move: 'DECLINE', discountPct: null }),
        supplierView,
        counter,
        2,
      ),
    ).toMatchObject({ type: 'DECLINE' });
    // Within the ceiling it is a plain counter.
    expect(
      supplierMoveFrom(supplierSays(), { ...supplierView, otherRowsCost: 0n }, counter, 2),
    ).toMatchObject({ type: 'COUNTER', terms: { discountBps: 120 } });
  });
});

describe('whatever a model says, no limit is broken', () => {
  // Random answers from both negotiators, on the real engine and database. Afterwards the transcript
  // is checked against each side's limits by code that shares nothing with the guards.
  const pct = fc.integer({ min: 1, max: 60 }).map((n) => (n / 10).toFixed(2));
  const clientArb = fc.record({
    move: fc.constantFrom('ACCEPT', 'COUNTER', 'DECLINE'),
    discountPct: fc.option(pct, { nil: null }),
    amountEarly: fc.option(
      fc.integer({ min: 1, max: 9 }).map((n) => `${String(n * 250)}.00`),
      { nil: null },
    ),
    reason: fc.constant('whatever'),
  });
  const supplierArb = fc.record({
    move: fc.constantFrom('ACCEPT', 'COUNTER', 'DECLINE'),
    discountPct: fc.option(pct, { nil: null }),
    reason: fc.constant('whatever'),
  });

  it('keeps every message within the owner’s maximum, the client’s hurdle and the approval rules', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(clientArb, { minLength: 4, maxLength: 4 }),
        fc.array(supplierArb, { minLength: 4, maxLength: 4 }),
        async (clientAnswers, supplierAnswers) => {
          await resetDb(db);
          ids = await seedScenario(db);
          let c = 0;
          let s = 0;
          const runner = new ScriptedRunner((call) =>
            call.role === 'client-negotiator'
              ? clientAnswers[c++ % clientAnswers.length]
              : supplierAnswers[s++ % supplierAnswers.length],
          );
          const { engine } = engineWith(runner);
          const demo = await approvedDemoPlan(db, ids, plans);
          await engine.runAgents(demo.harbor);

          const messages = await db.negotiationMessage.findMany({ where: { dealId: demo.harbor } });
          const approvedOverCeiling =
            (await db.approval.count({
              where: { dealId: demo.harbor, type: 'COUNTER_OVER_PLAN', decision: 'APPROVED' },
            })) > 0;
          for (const m of messages) {
            if (m.terms === null) continue;
            const t = wireToTerms(m.terms as Parameters<typeof wireToTerms>[0]);
            // Owner limit: nothing offered by the supplier's side is above 1.20%.
            if (m.fromParty.startsWith('supplier:')) expect(t.discountBps).toBeLessThanOrEqual(120);
            // Client limit: terms the client's side proposes meet its 15% hurdle and its $5,000
            // early-pay cap.
            if (m.fromParty.startsWith('client:')) {
              expect(t.amountEarly).toBeLessThanOrEqual(dollars(5000));
              const days = Math.round(
                (Date.parse('2026-12-04T00:00:00Z') - Date.parse(`${t.payBy}T00:00:00Z`)) /
                  86_400_000,
              );
              expect(meetsAnnualRate(t.discountBps, days, 1500)).toBe(true);
            }
            expect(t.discountBps % 10).toBe(0);
          }
          expect(messages.length).toBeLessThanOrEqual(2 * 3 + 1);
          const deal = await db.deal.findUniqueOrThrow({ where: { id: demo.harbor } });
          expect(deal.round).toBeLessThanOrEqual(3);
          if (deal.state === 'AGREED') {
            // Agreed: within the maximum, and within the ceiling unless the owner approved going over.
            const agreed = wireToTerms(deal.agreedTerms as Parameters<typeof wireToTerms>[0]);
            expect(agreed.discountBps).toBeLessThanOrEqual(120);
            const live = ['AGREED', 'APPROVED', 'SENT', 'COUNTERED', 'NEEDS_OWNER'];
            const planCost = (await db.deal.findMany({ where: { planId: demo.planId } }))
              .filter((d) => d.action !== 'REMINDER' && live.includes(d.state))
              .reduce((sum, d) => sum + d.costCents, 0n);
            expect(planCost <= dollars(60) || approvedOverCeiling).toBe(true);
          }
          // Nothing is waiting on the owner without an approval for them to decide.
          if (deal.state === 'NEEDS_OWNER') {
            expect(
              await db.approval.count({
                where: { dealId: demo.harbor, type: 'COUNTER_OVER_PLAN', decision: 'PENDING' },
              }),
            ).toBe(1);
          }
        },
      ),
      { numRuns: 30 },
    );
  }, 180_000);
});
