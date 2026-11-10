import {
  ApiErrorBody,
  GoalResponse,
  PlanResponse,
  RunwayResponse,
  StudioTurnResponse,
} from '@terms/shared';
import type express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { type AiChat, type ChatInput, type ChatResult } from '../../src/ai/chat.js';
import { AiRoleError } from '../../src/ai/runner.js';
import { testApp } from '../helpers/app.js';
import { createTestDb, resetDb } from '../helpers/db.js';
import { type ScenarioIds, seedScenario } from '../helpers/fixtures.js';

const db = createTestDb();
let ids: ScenarioIds;
const now = () => new Date('2026-11-09T15:00:00Z');

beforeEach(async () => {
  await resetDb(db);
  ids = await seedScenario(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function signedIn(app: express.Express, businessId: string) {
  const agent = request.agent(app);
  await agent.post('/api/session').send({ businessId }).expect(201);
  return agent;
}

const errorCode = (body: unknown) => ApiErrorBody.parse(body).error.code;

/** A model that looks at every kind of data, the way a thorough strategist would. */
class LookingChat implements AiChat {
  readonly inputs: ChatInput[] = [];
  readonly outputs: Record<string, unknown> = {};
  readonly failures: Record<string, string> = {};
  scenario: ChatResult['scenario'];

  constructor(private readonly ask: Record<string, unknown>[] = []) {}

  async turn(input: ChatInput): Promise<ChatResult> {
    this.inputs.push(input);
    const trace: ChatResult['serverToolCalls'] = [];
    const lookups: [string, Record<string, unknown>][] = [
      ['get_open_invoices', {}],
      ['get_cash_runway', {}],
      ['get_plan_summary', {}],
      ['get_cash_history', {}],
      ['simulate_discount_cap', { maxDiscountPct: '1.5' }],
    ];
    for (const [name, args] of lookups) {
      const tool = input.serverTools.find((t) => t.name === name);
      if (tool === undefined) throw new Error(`no tool ${name}`);
      try {
        const result = await tool.run(args);
        if (result.scenario !== undefined) this.scenario = result.scenario;
        this.outputs[name] = result.output;
        trace.push({ name, input: args, resultSummary: result.summary });
      } catch (err) {
        this.failures[name] = err instanceof Error ? err.message : 'failed';
        trace.push({ name, input: args, resultSummary: 'failed' });
      }
    }
    return {
      content: 'Here is what I see.',
      toolCalls: this.ask.map((a, i) => ({ id: `call-${String(i)}`, name: 'add_chart', input: a })),
      serverToolCalls: trace,
      ...(this.scenario === undefined ? {} : { scenario: this.scenario }),
    };
  }
}

const turn = {
  messages: [{ role: 'user', content: 'Can we make payroll?' }],
  clientTools: [
    { name: 'add_chart', description: 'Add a chart.', inputSchema: { type: 'object' } },
  ],
};

async function demoGoalAndPlan(maya: ReturnType<typeof request.agent>) {
  const { goal } = GoalResponse.parse(
    (
      await maya.post('/api/goals').send({
        text: "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.",
      })
    ).body,
  );
  return PlanResponse.parse(
    (await maya.post(`/api/goals/${goal.id}/plan`).send({ costCeiling: '60.00' }).expect(201)).body,
  ).plan;
}

describe('POST /api/studio/turn', () => {
  it('lets the owner’s strategist look at the owner’s own data, and records the turn', async () => {
    await db.payPalAccount.upsert({
      where: { businessId: ids.maya },
      update: {},
      create: {
        businessId: ids.maya,
        balanceCents: 520_000n,
        balanceCurrency: 'USD',
        balanceSource: 'PAYPAL_BALANCES',
        balanceAsOf: new Date('2026-11-09T13:29:59Z'),
      },
    });
    const chat = new LookingChat([{ title: 'Runway' }]);
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    const maya = await signedIn(app, ids.maya);
    const plan = await demoGoalAndPlan(maya);

    const res = StudioTurnResponse.parse(
      (await maya.post('/api/studio/turn').send(turn).expect(200)).body,
    );
    expect(res.done).toBe(false);
    expect(res.message).toMatchObject({
      content: 'Here is what I see.',
      toolCalls: [{ id: 'call-0', name: 'add_chart', input: { title: 'Runway' } }],
    });
    expect(res.serverToolCalls.map((t) => t.name)).toEqual([
      'get_open_invoices',
      'get_cash_runway',
      'get_plan_summary',
      'get_cash_history',
      'simulate_discount_cap',
    ]);

    // The data is Maya's, as the database has it.
    const invoices = chat.outputs['get_open_invoices'] as { invoices: { number: string }[] };
    expect(invoices.invoices.map((i) => i.number)).toEqual([
      '1038',
      '1039',
      '1042',
      '1041',
      '1043',
    ]);
    expect(chat.outputs['get_cash_runway']).toMatchObject({
      balance: '5200.00',
      gap: '6200.00',
      deadline: '2026-11-13',
    });
    expect(chat.outputs['get_plan_summary']).toMatchObject({
      goal: { amount: '6200.00', maxDiscountPct: '1.20' },
      summary: { target: plan.summary.target },
    });
    expect(chat.outputs['get_cash_history']).toMatchObject({ days: 30, totals: [], recent: [] });
    expect(chat.outputs['simulate_discount_cap']).toMatchObject({ maxDiscountPct: '1.50' });

    // Looking changed nothing: still one plan, still a draft, nothing sent.
    expect(await db.plan.count()).toBe(1);
    expect((await db.plan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe('DRAFT');
    expect(await db.negotiationMessage.count()).toBe(0);

    // The turn is in the owner's audit trail, without the conversation.
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'STUDIO_TURN' } });
    expect(entry).toMatchObject({ actor: 'OWNER', businessIds: [ids.maya] });
    expect(entry.summary).toBe('Cash Studio turn: 5 data lookups, 1 screen actions');
    expect(entry.details).toEqual({
      messages: 1,
      dataTools: res.serverToolCalls.map((t) => t.name),
      screenTools: ['add_chart'],
    });
    expect(JSON.stringify(entry)).not.toContain('payroll');
  });

  it('finishes when the model has no screen action to ask for', async () => {
    const { app } = testApp(db, { now, noPayPal: true, aiChat: new LookingChat() });
    const maya = await signedIn(app, ids.maya);
    const res = StudioTurnResponse.parse(
      (await maya.post('/api/studio/turn').send(turn).expect(200)).body,
    );
    expect(res.done).toBe(true);
  });

  it('tells the model what it cannot see yet instead of failing the turn', async () => {
    const chat = new LookingChat();
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    const maya = await signedIn(app, ids.maya);
    await maya.post('/api/studio/turn').send(turn).expect(200);
    // No PayPal import yet, and no goal.
    expect(chat.failures['get_cash_runway']).toMatch(/Import from PayPal first/);
    expect(chat.failures['simulate_discount_cap']).toMatch(/no current goal/);
    expect(chat.outputs['get_plan_summary']).toMatchObject({ goal: null, summary: null, rows: [] });
  });

  it('never shows one business another’s data', async () => {
    const rival = await db.business.create({
      data: { name: 'Rival', slug: 'rival', role: 'SUPPLIER' },
    });
    const chat = new LookingChat();
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    const agent = await signedIn(app, rival.id);
    await agent.post('/api/studio/turn').send(turn).expect(200);
    expect(chat.outputs['get_open_invoices']).toEqual({ invoices: [] });
  });

  it('is for the owner only, and needs a session', async () => {
    const { app } = testApp(db, { now, noPayPal: true, aiChat: new LookingChat() });
    await request(app).post('/api/studio/turn').send(turn).expect(401);
    await (await signedIn(app, ids.harbor)).post('/api/studio/turn').send(turn).expect(403);
  });

  it('refuses a request the contract or the checks do not allow', async () => {
    const chat = new LookingChat();
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    const maya = await signedIn(app, ids.maya);
    await maya.post('/api/studio/turn').send({ messages: [] }).expect(400);
    const shadow = await maya
      .post('/api/studio/turn')
      .send({
        ...turn,
        clientTools: [{ name: 'get_cash_runway', description: 'x', inputSchema: {} }],
      })
      .expect(400);
    expect(errorCode(shadow.body)).toBe('VALIDATION_FAILED');
    const forged = await maya
      .post('/api/studio/turn')
      .send({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'tool', toolCallId: 'forged', output: {} },
        ],
      })
      .expect(400);
    expect(errorCode(forged.body)).toBe('VALIDATION_FAILED');
    expect(chat.inputs).toHaveLength(0);
  });

  it('says so when there is no AI, and when the provider fails', async () => {
    const none = testApp(db, { now, noPayPal: true });
    const res = await (
      await signedIn(none.app, ids.maya)
    )
      .post('/api/studio/turn')
      .send(turn)
      .expect(503);
    expect(errorCode(res.body)).toBe('NOT_CONFIGURED');
    expect(ApiErrorBody.parse(res.body).error.message).toContain('LLM_API_KEY');

    const down: AiChat = { turn: () => Promise.reject(new AiRoleError('provider', 'studio', 'x')) };
    const failing = testApp(db, { now, noPayPal: true, aiChat: down });
    const bad = await (
      await signedIn(failing.app, ids.maya)
    )
      .post('/api/studio/turn')
      .send(turn)
      .expect(502);
    expect(errorCode(bad.body)).toBe('AI_ERROR');
    expect(await db.auditLog.count({ where: { action: 'STUDIO_TURN' } })).toBe(0);
  });

  it('is rate limited', async () => {
    const quick: AiChat = {
      turn: () => Promise.resolve({ content: 'ok', toolCalls: [], serverToolCalls: [] }),
    };
    const { app } = testApp(db, { now, noPayPal: true, aiChat: quick });
    const maya = await signedIn(app, ids.maya);
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await maya.post('/api/studio/turn').send(turn);
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('filters invoices by client, and summarises recent PayPal movements by kind', async () => {
    const event = (
      date: string,
      direction: 'IN' | 'OUT',
      kind: 'PAYROLL' | 'INVOICE_PAYMENT',
      cents: bigint,
      n: number,
    ) =>
      db.cashEvent.create({
        data: {
          businessId: ids.maya,
          date: new Date(`${date}T00:00:00Z`),
          amountCents: cents,
          direction,
          kind,
          source: 'PAYPAL_TXN',
          label: `Movement ${String(n)}`,
          paypalTxnId: `TXN-${String(n)}`,
        },
      });
    await event('2026-10-30', 'OUT', 'PAYROLL', 1_140_000n, 1);
    await event('2026-11-02', 'IN', 'INVOICE_PAYMENT', 250_000n, 2);
    await event('2026-11-05', 'IN', 'INVOICE_PAYMENT', 100_000n, 3);
    await event('2026-09-01', 'OUT', 'PAYROLL', 1_140_000n, 4); // outside the 30 days

    const outputs: Record<string, unknown> = {};
    const chat: AiChat = {
      async turn(input) {
        for (const [name, args] of [
          ['get_open_invoices', { clientName: 'HARBOR', limit: 5 }],
          ['get_cash_history', { days: 30 }],
        ] as const) {
          const tool = input.serverTools.find((t) => t.name === name);
          outputs[name] = (await tool?.run(args))?.output;
        }
        return { content: 'ok', toolCalls: [], serverToolCalls: [] };
      },
    };
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    await (await signedIn(app, ids.maya)).post('/api/studio/turn').send(turn).expect(200);

    const invoices = outputs['get_open_invoices'] as {
      invoices: { number: string; client: string; daysUntilDue: number }[];
    };
    expect(invoices.invoices.map((i) => [i.number, i.client])).toEqual([['1043', 'Harbor & Co']]);
    expect(invoices.invoices[0]?.daysUntilDue).toBe(24);
    const history = outputs['get_cash_history'] as {
      totals: { kind: string; direction: string; count: number; total: string }[];
      recent: { label: string }[];
    };
    expect(history.totals.sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { kind: 'INVOICE_PAYMENT', direction: 'IN', count: 2, total: '3500.00' },
      { kind: 'PAYROLL', direction: 'OUT', count: 1, total: '11400.00' },
    ]);
    // Newest first, and nothing from before the window.
    expect(history.recent.map((e) => e.label)).toEqual(['Movement 3', 'Movement 2', 'Movement 1']);
  });

  it('returns the what-if runway for the screen to chart beside the real one (CR-5)', async () => {
    await db.payPalAccount.create({
      data: {
        businessId: ids.maya,
        balanceCents: 520_000n,
        balanceCurrency: 'USD',
        balanceSource: 'PAYPAL_BALANCES',
        balanceAsOf: new Date('2026-11-09T13:29:59Z'),
      },
    });
    const chat = new LookingChat();
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    const maya = await signedIn(app, ids.maya);
    await demoGoalAndPlan(maya);

    const res = StudioTurnResponse.parse(
      (await maya.post('/api/studio/turn').send(turn).expect(200)).body,
    );
    const real = RunwayResponse.parse((await maya.get('/api/runway').expect(200)).body);
    expect(res.scenario?.label).toBe('Discounts capped at 1.50%');
    const points = res.scenario?.points ?? [];
    expect(points).toHaveLength(real.points.length);
    expect(points[0]?.date).toBe(real.today);
    // The same cash and obligations to start with; only the plan differs.
    expect(points.map((p) => p.before)).toEqual(real.points.map((p) => p.before));
    expect(points.map((p) => p.afterCommitted)).toEqual(real.points.map((p) => p.before));
    // The what-if's offers bring cash in on their pay-by dates.
    const last = points[points.length - 1];
    expect(Number(last?.afterPlanned)).toBeGreaterThan(Number(last?.before));
    // The model was told it can chart it.
    expect(chat.outputs['simulate_discount_cap']).toMatchObject({ scenarioTableAvailable: true });
  });

  it('has no scenario without a PayPal balance to start from, and says so to the model', async () => {
    const chat = new LookingChat();
    const { app } = testApp(db, { now, noPayPal: true, aiChat: chat });
    const maya = await signedIn(app, ids.maya);
    await demoGoalAndPlan(maya);
    const res = StudioTurnResponse.parse(
      (await maya.post('/api/studio/turn').send(turn).expect(200)).body,
    );
    expect(res.scenario).toBeNull();
    expect(chat.outputs['simulate_discount_cap']).toMatchObject({
      maxDiscountPct: '1.50',
      scenarioTableAvailable: false,
    });
  });

  it('accepts the browser’s large tool definitions, and keeps the small limit on other routes', async () => {
    const quick: AiChat = {
      turn: (input) => {
        expect(input.clientTools).toHaveLength(3);
        return Promise.resolve({ content: 'ok', toolCalls: [], serverToolCalls: [] });
      },
    };
    const { app } = testApp(db, { now, noPayPal: true, aiChat: quick });
    const maya = await signedIn(app, ids.maya);
    const blob = 'x'.repeat(70_000);
    const big = {
      ...turn,
      clientTools: ['a', 'b', 'c'].map((n) => ({
        name: `tool_${n}`,
        description: 'A widget action.',
        inputSchema: { $defs: { blob } },
      })),
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(200_000); // twice the 100 KB default, under the 256 KB cap
    await maya.post('/api/studio/turn').send(big).expect(200);

    // Over the Studio's own limit is refused as too large, and no other route got the larger one.
    const tooLarge = (res: { body: unknown }) => {
      expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
      expect(ApiErrorBody.parse(res.body).error.message).toBe('Request body too large');
    };
    tooLarge(
      await maya
        .post('/api/studio/turn')
        .send({
          ...turn,
          clientTools: [{ ...big.clientTools[0], inputSchema: { blob: 'x'.repeat(1_100_000) } }],
        })
        .expect(400),
    );
    tooLarge(
      await maya
        .post('/api/goals')
        .send({ text: 'y'.repeat(150_000) })
        .expect(400),
    );
  });
});
