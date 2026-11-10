/**
 * The Cash Studio strategist's server tools (packages/shared studio.ts): five read-only views of
 * the owner's own data, run on the server inside a turn. Each returns a compact, bounded result
 * and a one-line summary for the trace. None can change anything.
 */
import {
  formatMoney,
  normalizePercentInput,
  percentToBps,
  type PlanSummary,
  type RunwayResponse,
  type StudioServerTool,
} from '@terms/shared';
import { z } from 'zod';
import { type CapSimulation } from '../plans/plan-service.js';
import { type ChatServerTool } from './chat.js';

export interface StudioInvoice {
  number: string;
  client: string;
  amount: string;
  amountDue: string;
  dueDate: string;
  daysUntilDue: number;
  status: string;
  contactAllowed: boolean;
}

export interface StudioPlan {
  goal: {
    amount: string;
    deadline: string;
    maxDiscountPct: string;
    bufferPct: string;
    status: string;
  } | null;
  summary: PlanSummary | null;
  rows: {
    invoiceNumber: string;
    client: string;
    action: string;
    rank: string;
    discountPct: string | null;
    amountEarly: string | null;
    cost: string;
    committedIfAgreed: string;
    dealState: string | null;
  }[];
}

export interface StudioHistory {
  days: number;
  totals: { kind: string; direction: string; count: number; total: string }[];
  recent: { date: string; direction: string; amount: string; kind: string; label: string }[];
}

/** Where the tools read from. Implemented over the database for a signed-in owner. */
export interface StudioData {
  openInvoices(filter: { clientName?: string; limit: number }): Promise<StudioInvoice[]>;
  runway(horizonDays: number): Promise<RunwayResponse>;
  plan(): Promise<StudioPlan>;
  cashHistory(days: number): Promise<StudioHistory>;
  /** Null when the owner has no goal to plan for. */
  simulate(maxDiscountBps: number): Promise<CapSimulation | null>;
}

/** Rows kept in a result: enough to reason over, never the whole database. */
const MAX_ROWS = 25;
const MAX_POINTS = 16;
const MAX_EVENTS = 15;

const OpenInvoicesInput = z.object({
  clientName: z
    .string()
    .max(100)
    .optional()
    .describe('Only invoices to clients whose name has this.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(25)
    .describe('How many invoices, soonest due first.'),
});
const RunwayInput = z.object({
  horizonDays: z.number().int().min(7).max(90).default(30).describe('Days after today to project.'),
});
const NoInput = z.object({});
const HistoryInput = z.object({
  days: z.number().int().min(1).max(90).default(30).describe('How many days back.'),
});
const SimulateInput = z.object({
  maxDiscountPct: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .describe('The most you would offer as an early-payment discount, in percent, e.g. "1.5".'),
});

/** Evenly spaced entries of a list, always including the last. */
function sample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)] as T);
}

function lowest(points: RunwayResponse['points'], key: 'before' | 'afterPlanned') {
  let low: { date: string; balance: string } | null = null;
  for (const p of points) {
    if (low === null || Number(p[key]) < Number(low.balance))
      low = { date: p.date, balance: p[key] };
  }
  return low;
}

export function buildStudioTools(data: StudioData): ChatServerTool[] {
  const tools: (ChatServerTool & { name: StudioServerTool })[] = [
    {
      name: 'get_open_invoices',
      description:
        "The owner's open invoices, soonest due first: client, amount due, due date, status.",
      input: OpenInvoicesInput,
      run: async (raw) => {
        const { clientName, limit } = OpenInvoicesInput.parse(raw);
        const invoices = await data.openInvoices({
          limit,
          ...(clientName === undefined ? {} : { clientName }),
        });
        const shown = invoices.slice(0, limit);
        const due = shown.reduce((sum, i) => sum + Number(i.amountDue), 0);
        return {
          output: { invoices: shown },
          summary: `${String(shown.length)} open invoices, ${formatMoney(due.toFixed(2))} due`,
        };
      },
    },
    {
      name: 'get_cash_runway',
      description:
        'The PayPal balance and the day-by-day cash projection: before the plan (balance plus ' +
        'confirmed recurring flows), after committed deals, and after planned offers.',
      input: RunwayInput,
      run: async (raw) => {
        const { horizonDays } = RunwayInput.parse(raw);
        const r = await data.runway(horizonDays);
        const low = lowest(r.points, 'before');
        return {
          output: {
            today: r.today,
            balance: r.balance,
            balanceAsOf: r.asOf,
            deadline: r.deadline,
            gap: r.gap,
            committed: r.committed,
            bestEffort: r.bestEffort,
            obligations: r.thresholds,
            lowestBeforePlan: low,
            lowestAfterPlan: lowest(r.points, 'afterPlanned'),
            points: sample(r.points, MAX_POINTS),
            events: r.events.slice(0, MAX_EVENTS),
          },
          summary: `balance ${formatMoney(r.balance)}${low === null ? '' : `, lowest ${formatMoney(low.balance)} on ${low.date}`}`,
        };
      },
    },
    {
      name: 'get_plan_summary',
      description:
        "The owner's current goal and plan: the gap, what is committed, cost, and each row.",
      input: NoInput,
      run: async () => {
        const plan = await data.plan();
        const committed =
          plan.summary === null ? '' : `, ${formatMoney(plan.summary.committed)} committed`;
        return {
          output: { goal: plan.goal, summary: plan.summary, rows: plan.rows.slice(0, MAX_ROWS) },
          summary:
            plan.goal === null
              ? 'no current goal'
              : `goal ${formatMoney(plan.goal.amount)} by ${plan.goal.deadline}${committed}`,
        };
      },
    },
    {
      name: 'get_cash_history',
      description:
        "Money in and out of the owner's PayPal account over recent days: totals by kind, and the latest movements.",
      input: HistoryInput,
      run: async (raw) => {
        const { days } = HistoryInput.parse(raw);
        const h = await data.cashHistory(days);
        const count = h.totals.reduce((sum, t) => sum + t.count, 0);
        return {
          output: { days: h.days, totals: h.totals, recent: h.recent.slice(0, MAX_ROWS) },
          summary: `${String(count)} movements in the last ${String(h.days)} days`,
        };
      },
    },
    {
      name: 'simulate_discount_cap',
      description:
        'What the planner would do if the most you offered as a discount were different. ' +
        'Read-only: nothing is saved or changed.',
      input: SimulateInput,
      run: async (raw) => {
        const { maxDiscountPct } = SimulateInput.parse(raw);
        const normal = normalizePercentInput(maxDiscountPct);
        const bps = normal === null ? 0 : percentToBps(normal);
        if (bps <= 0 || bps > 2000)
          throw new Error('The discount must be above 0% and at most 20%');
        const sim = await data.simulate(bps);
        if (sim === null) throw new Error('There is no current goal to simulate');
        return {
          output: { ...sim, offers: sim.offers.slice(0, MAX_ROWS) },
          summary: `at ${sim.maxDiscountPct}%: commits ${formatMoney(sim.plannedCommitted)} for ${formatMoney(sim.plannedCost)}${sim.shortfall ? ' (short of the target)' : ''}`,
        };
      },
    },
  ];
  return tools;
}
