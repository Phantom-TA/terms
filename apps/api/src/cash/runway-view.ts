/**
 * The cash runway for a supplier: the day-by-day balance before and after the plan's deals. Used by
 * the runway route and by the Cash Studio's data tool, so both read the same figures.
 */
import { isoDateInTimeZone, NegotiationTerms, type RunwayResponse, toCents } from '@terms/shared';
import { AppError, notFound } from '../errors.js';
import { dateToIso } from '../mappers.js';
import { type Services } from '../services.js';
import { computeRunway, type RunwayDeal, type RunwayFlow } from './runway.js';

const COMMITTED = ['AGREED', 'INVOICE_UPDATED', 'AWAITING_PAYMENT'] as const;
const OPEN_DEAL = ['APPROVED', 'SENT', 'COUNTERED', 'NEEDS_OWNER'] as const;

export async function runwayFor(
  s: Pick<Services, 'db' | 'goals' | 'plans' | 'now'>,
  supplier: { id: string; timeZone: string },
  query: { planId?: string | undefined; horizonDays: number },
): Promise<RunwayResponse> {
  const supplierId = supplier.id;
  const account = await s.db.payPalAccount.findUnique({ where: { businessId: supplierId } });
  const balanceCents = account?.balanceCents ?? null;
  const balanceAsOf = account?.balanceAsOf ?? null;
  if (account === null || balanceCents === null || balanceAsOf === null) {
    throw new AppError(
      'CONFLICT',
      'Import from PayPal first: the runway starts from your PayPal balance',
    );
  }
  const today = isoDateInTimeZone(s.now(), supplier.timeZone);
  const current = await s.goals.current(supplierId);
  let planId = query.planId ?? current?.planId ?? null;
  if (query.planId !== undefined) {
    const owned = await s.db.plan.findUnique({
      where: { id: query.planId },
      select: { goal: { select: { supplierId: true } } },
    });
    if (owned?.goal.supplierId !== supplierId) throw notFound('Plan');
    planId = query.planId;
  }
  const plan = planId === null ? null : await s.plans.getView(planId, supplierId);
  const goal =
    planId === null
      ? null
      : await s.db.goal.findFirst({ where: { plans: { some: { id: planId } } } });

  const recurring = await s.db.cashEvent.findMany({
    where: {
      businessId: supplierId,
      source: 'CONFIRMED_RECURRING',
      date: { gte: new Date(`${today}T00:00:00Z`) },
    },
  });
  const flows: RunwayFlow[] = recurring.map((f) => ({
    date: dateToIso(f.date),
    amountCents: f.direction === 'IN' ? f.amountCents : -f.amountCents,
    kind: f.kind,
    label: f.label,
  }));

  const rows =
    planId === null
      ? []
      : await s.db.deal.findMany({ where: { planId }, include: { invoice: true, client: true } });
  const deals: RunwayDeal[] = [];
  let confirmedSince = 0n;
  for (const d of rows) {
    const terms = NegotiationTerms.safeParse(d.agreedTerms ?? d.currentTerms);
    const payBy = terms.success ? terms.data.payBy : today;
    const label = `${d.client.name}, invoice ${d.invoice.number}`;
    if (d.action === 'REMINDER') {
      if (d.state !== 'PAID' && d.state !== 'WITHDRAWN' && d.state !== 'FAILED') {
        deals.push({
          date: dateToIso(d.invoice.dueDate),
          amountCents: d.invoice.amountDueCents,
          stage: 'REMINDER',
          label,
        });
      }
    } else if (d.state === 'PAID' || d.state === 'PARTIALLY_PAID') {
      deals.push({ date: payBy, amountCents: d.committedCents, stage: 'PAID', label });
      // PayPal's balance lags (spike S4): add what PayPal confirmed after its timestamp.
      if (d.updatedAt > balanceAsOf) confirmedSince += d.committedCents;
    } else if ((COMMITTED as readonly string[]).includes(d.state)) {
      deals.push({ date: payBy, amountCents: d.committedCents, stage: 'COMMITTED', label });
    } else if ((OPEN_DEAL as readonly string[]).includes(d.state)) {
      deals.push({ date: payBy, amountCents: d.committedCents, stage: 'OPEN', label });
    }
  }

  return computeRunway({
    today,
    horizonDays: query.horizonDays,
    balanceCents,
    balanceAsOf,
    confirmedSinceCents: confirmedSince,
    currency: account.balanceCurrency,
    planId,
    deadline: goal === null ? null : dateToIso(goal.deadline),
    gapCents: goal?.amountCents ?? 0n,
    committedCents: plan === null ? 0n : toCents(plan.summary.committed),
    bestEffortCents: plan === null ? 0n : toCents(plan.summary.bestEffort),
    flows,
    deals,
  });
}
