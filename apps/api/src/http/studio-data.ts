/** The Cash Studio's read-only data tools, over the database, for one signed-in owner. */
import { addDays, diffDays, isoDateInTimeZone, type Plan as PlanView } from '@terms/shared';
import { type StudioData, type StudioPlan } from '../ai/studio-tools.js';
import { runwayFor, scenarioRunway } from '../cash/runway-view.js';
import { AppError } from '../errors.js';
import { toGoalView } from '../goals/goal-service.js';
import { dateToIso, money } from '../mappers.js';
import { type Services } from '../services.js';

/** The what-if runway covers the same default horizon as the real one. */
const WHAT_IF_HORIZON_DAYS = 30;

const OPEN_INVOICE = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED', 'PAYMENT_PENDING'] as const;

export function studioData(s: Services, supplier: { id: string; timeZone: string }): StudioData {
  const today = () => isoDateInTimeZone(s.now(), supplier.timeZone);
  return {
    async openInvoices({ clientName, limit }) {
      const rows = await s.db.invoice.findMany({
        where: {
          supplierId: supplier.id,
          paypalStatus: { in: [...OPEN_INVOICE] },
          amountDueCents: { gt: 0 },
          ...(clientName === undefined
            ? {}
            : { client: { name: { contains: clientName, mode: 'insensitive' as const } } }),
        },
        include: { client: true },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
        take: limit,
      });
      const now = today();
      return rows.map((inv) => ({
        number: inv.number,
        client: inv.client.name,
        amount: money(inv.amountCents),
        amountDue: money(inv.amountDueCents),
        dueDate: dateToIso(inv.dueDate),
        daysUntilDue: diffDays(dateToIso(inv.dueDate), now),
        status: inv.paypalStatus,
        contactAllowed: inv.contactAllowed,
      }));
    },

    runway: (horizonDays) => runwayFor(s, supplier, { horizonDays }),

    async plan(): Promise<StudioPlan> {
      const current = await s.goals.current(supplier.id);
      if (current === null) return { goal: null, summary: null, rows: [] };
      const goal = toGoalView(current.goal);
      const plan: PlanView | null =
        current.planId === null ? null : await s.plans.getView(current.planId, supplier.id);
      return {
        goal: {
          amount: goal.amount,
          deadline: goal.deadline,
          maxDiscountPct: goal.maxDiscountPct,
          bufferPct: goal.bufferPct,
          status: goal.status,
        },
        summary: plan?.summary ?? null,
        rows: (plan?.items ?? []).map((i) => ({
          invoiceNumber: i.invoiceNumber,
          client: i.client.name,
          action: i.action,
          rank: i.rank,
          discountPct: i.discountPct,
          amountEarly: i.amountEarly,
          cost: i.cost,
          committedIfAgreed: i.committedIfAgreed,
          dealState: i.dealState,
        })),
      };
    },

    async cashHistory(days) {
      const since = addDays(today(), -days);
      const events = await s.db.cashEvent.findMany({
        where: {
          businessId: supplier.id,
          source: 'PAYPAL_TXN',
          date: { gte: new Date(`${since}T00:00:00Z`) },
        },
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
      });
      const totals = new Map<
        string,
        { kind: string; direction: string; count: number; cents: bigint }
      >();
      for (const e of events) {
        const key = `${e.kind}/${e.direction}`;
        const t = totals.get(key) ?? { kind: e.kind, direction: e.direction, count: 0, cents: 0n };
        t.count += 1;
        t.cents += e.amountCents;
        totals.set(key, t);
      }
      return {
        days,
        totals: [...totals.values()].map((t) => ({
          kind: t.kind,
          direction: t.direction,
          count: t.count,
          total: money(t.cents),
        })),
        recent: events.slice(0, 25).map((e) => ({
          date: dateToIso(e.date),
          direction: e.direction,
          amount: money(e.amountCents),
          kind: e.kind,
          label: e.label,
        })),
      };
    },

    async simulate(maxDiscountBps) {
      const current = await s.goals.current(supplier.id);
      if (current === null) return null;
      const simulation = await s.plans.simulateCap(current.goal.id, supplier.id, maxDiscountBps);
      // The what-if runway starts from the PayPal balance; without one there is nothing to chart.
      const scenario = await scenarioRunway(s, supplier, simulation, WHAT_IF_HORIZON_DAYS).catch(
        (err: unknown) => {
          if (err instanceof AppError && err.code === 'CONFLICT') return null;
          throw err;
        },
      );
      return { simulation, scenario };
    },
  };
}
