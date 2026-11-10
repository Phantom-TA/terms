/** Goals, plans, deals and the Workbench's invoice rows (owner routes, plus a deal's client). */
import {
  diffDays,
  endpoints,
  type InvoiceRow,
  isoDateInTimeZone,
  type Plan as PlanView,
  toCents,
} from '@terms/shared';
import { type Router } from 'express';
import { notFound } from '../../errors.js';
import { toGoalView } from '../../goals/goal-service.js';
import { dateToIso, money } from '../../mappers.js';
import { type Services } from '../../services.js';
import { dealDetail, dealSummary, dealSummaryInclude } from '../deal-views.js';
import { route } from '../route.js';
import { businessRef } from '../views.js';

const OPEN_STATUSES = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'SCHEDULED', 'PAYMENT_PENDING'] as const;

export function registerPlanningRoutes(router: Router, s: Services): void {
  const publishPlan = (plan: PlanView, supplierId: string) =>
    s.events.publish([supplierId], {
      type: 'plan.updated',
      data: { planId: plan.id, status: plan.status, summary: plan.summary },
    });

  /** The plan a request means: the one named, or the current goal's latest plan. */
  const planIdFor = async (
    supplierId: string,
    requested: string | undefined,
  ): Promise<string | null> => {
    if (requested !== undefined) {
      const plan = await s.db.plan.findUnique({
        where: { id: requested },
        select: { goal: { select: { supplierId: true } } },
      });
      if (plan?.goal.supplierId !== supplierId) throw notFound('Plan');
      return requested;
    }
    return (await s.goals.current(supplierId))?.planId ?? null;
  };

  // ---------------------------------------------------------------- goals

  route(router, s.sessions, endpoints.createGoal, async ({ body, session }) => ({
    goal: await s.goals.createFromText(session.businessId, body.text),
  }));

  route(router, s.sessions, endpoints.currentGoal, async ({ session }) => {
    const current = await s.goals.current(session.businessId);
    if (current === null) return { goal: null, plan: null };
    return {
      goal: toGoalView(current.goal),
      plan:
        current.planId === null ? null : await s.plans.getView(current.planId, session.businessId),
    };
  });

  route(router, s.sessions, endpoints.getGoal, async ({ params, session }) => ({
    goal: toGoalView(await s.goals.get(params['goalId'] ?? '', session.businessId)),
  }));

  route(router, s.sessions, endpoints.updateGoal, async ({ params, body, session }) => ({
    goal: await s.goals.update(params['goalId'] ?? '', session.businessId, body),
  }));

  // ---------------------------------------------------------------- plans

  route(router, s.sessions, endpoints.createPlan, async ({ params, body, session }) => {
    const goal = await s.goals.get(params['goalId'] ?? '', session.businessId);
    const planId = await s.plans.createPlan(
      goal.id,
      body.costCeiling === undefined ? undefined : toCents(body.costCeiling),
    );
    const plan = await s.plans.getView(planId, session.businessId);
    await publishPlan(plan, session.businessId);
    return { plan };
  });

  route(router, s.sessions, endpoints.getPlan, async ({ params, session }) => ({
    plan: await s.plans.getView(params['planId'] ?? '', session.businessId),
  }));

  route(router, s.sessions, endpoints.updatePlanItem, async ({ params, body, session }) => {
    const result = await s.plans.editItem(
      params['planId'] ?? '',
      params['itemId'] ?? '',
      session.businessId,
      body,
    );
    await publishPlan(result.plan, session.businessId);
    return result;
  });

  route(router, s.sessions, endpoints.approvePlan, async ({ params, body, session }) => {
    const plan = await s.plans.approve(
      params['planId'] ?? '',
      session.businessId,
      toCents(body.costCeiling),
    );
    await publishPlan(plan, session.businessId);
    await s.publishDeals(plan.items.flatMap((i) => (i.dealId === null ? [] : [i.dealId])));
    return { plan };
  });

  // ---------------------------------------------------------------- deals

  route(router, s.sessions, endpoints.listDeals, async ({ query, session }) => {
    const planId = await planIdFor(session.businessId, query.planId);
    if (planId === null) return { planId: null, deals: [] };
    const deals = await s.db.deal.findMany({
      where: { planId, ...(query.state === undefined ? {} : { state: query.state }) },
      include: dealSummaryInclude,
      orderBy: [{ invoice: { dueDate: 'asc' } }, { createdAt: 'asc' }],
    });
    return { planId, deals: deals.map(dealSummary) };
  });

  route(router, s.sessions, endpoints.getDeal, ({ params, session }) =>
    dealDetail(s.db, params['dealId'] ?? '', session.businessId),
  );

  // ---------------------------------------------------------------- the Workbench rows

  route(router, s.sessions, endpoints.listInvoices, async ({ query, session }) => {
    const supplier = await s.db.business.findUniqueOrThrow({
      where: { id: session.businessId },
      include: { paypalAccount: true },
    });
    const today = isoDateInTimeZone(s.now(), supplier.timeZone);
    const planId = await planIdFor(session.businessId, query.planId);
    const plan = planId === null ? null : await s.plans.getView(planId, session.businessId);
    const invoices = await s.db.invoice.findMany({
      where: {
        supplierId: session.businessId,
        ...(query.includeClosed ? {} : { paypalStatus: { in: [...OPEN_STATUSES] } }),
      },
      include: { client: true },
      orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
    });
    const deals =
      planId === null
        ? []
        : await s.db.deal.findMany({ where: { planId }, include: dealSummaryInclude });
    const rows: InvoiceRow[] = invoices.map((inv) => {
      const items = plan?.items.filter((i) => i.invoiceId === inv.id) ?? [];
      const deal = deals.find((d) => d.invoiceId === inv.id);
      return {
        id: inv.id,
        paypalInvoiceId: inv.paypalInvoiceId,
        number: inv.number,
        client: businessRef(inv.client),
        amount: money(inv.amountCents),
        currency: inv.currency,
        amountPaid: money(inv.amountPaidCents),
        amountDue: money(inv.amountDueCents),
        issueDate: inv.issueDate === null ? null : dateToIso(inv.issueDate),
        dueDate: dateToIso(inv.dueDate),
        daysUntilDue: diffDays(dateToIso(inv.dueDate), today),
        paypalStatus: inv.paypalStatus,
        contactAllowed: inv.contactAllowed,
        paypalUrl: inv.paypalUrl,
        isDemo: inv.isDemo,
        lastSyncedAt: inv.lastSyncedAt.toISOString(),
        planItem: items.find((i) => i.rank === 'PRIMARY') ?? null,
        backups: items.filter((i) => i.rank === 'BACKUP'),
        deal: deal === undefined ? null : dealSummary(deal),
      };
    });
    return {
      rows,
      planId,
      today,
      lastSyncedAt: supplier.paypalAccount?.lastSyncedAt?.toISOString() ?? null,
      demo: supplier.isDemo,
    };
  });
}
