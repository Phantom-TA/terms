/**
 * The cash runway (CONTEXT.md, screen 3: "Runway chart with the payroll line, before and after").
 * Pure arithmetic over money in cents:
 *  - before: today's balance plus the owner's confirmed recurring flows (payroll, rent, …);
 *  - afterCommitted: plus deals both sides agreed (or PayPal already paid), on their pay-by date;
 *  - afterPlanned: plus offers still open, as if accepted;
 *  - afterBestEffort: plus reminded invoices on their due date (never counted toward the goal).
 * The balance is PayPal's, as of its own timestamp (reporting lags, spike S4); payments Terms has
 * seen PayPal confirm since then are added so a just-paid deal never looks missing.
 */
import { addDays, type Cents, diffDays, formatMoney, type RunwayResponse } from '@terms/shared';
import { fromCents } from '@terms/shared';

export interface RunwayFlow {
  date: string;
  /** Positive in, negative out. */
  amountCents: Cents;
  kind:
    | 'PAYROLL'
    | 'RENT'
    | 'CONTRACTOR'
    | 'SUBSCRIPTION'
    | 'TAX'
    | 'INVOICE_PAYMENT'
    | 'TRANSFER'
    | 'OTHER';
  label: string;
}

export type RunwayDealStage = 'COMMITTED' | 'PAID' | 'OPEN' | 'REMINDER';

export interface RunwayDeal {
  /** When the cash is expected (or arrived). */
  date: string;
  amountCents: Cents;
  stage: RunwayDealStage;
  label: string;
}

export interface RunwayInput {
  today: string;
  horizonDays: number;
  balanceCents: Cents;
  balanceAsOf: Date;
  /** Payments PayPal confirmed after the balance's timestamp. */
  confirmedSinceCents: Cents;
  currency: string;
  planId: string | null;
  deadline: string | null;
  gapCents: Cents;
  committedCents: Cents;
  bestEffortCents: Cents;
  flows: readonly RunwayFlow[];
  deals: readonly RunwayDeal[];
}

const onOrAfter = (date: string, today: string): string => (date < today ? today : date);

export function computeRunway(input: RunwayInput): RunwayResponse {
  const { today, horizonDays } = input;
  const base = input.balanceCents + input.confirmedSinceCents;
  const flows = input.flows.filter(
    (f) => f.date >= today && diffDays(f.date, today) <= horizonDays,
  );
  const sum = (items: readonly { date: string; amountCents: Cents }[], day: string) =>
    items.reduce(
      (total, i) => (onOrAfter(i.date, today) <= day ? total + i.amountCents : total),
      0n,
    );
  const committed = input.deals.filter((d) => d.stage === 'COMMITTED');
  const open = input.deals.filter((d) => d.stage === 'OPEN');
  const reminders = input.deals.filter((d) => d.stage === 'REMINDER');

  const points: RunwayResponse['points'] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const day = addDays(today, i);
    const before = base + sum(flows, day);
    const afterCommitted = before + sum(committed, day);
    const afterPlanned = afterCommitted + sum(open, day);
    points.push({
      date: day,
      before: fromCents(before),
      afterCommitted: fromCents(afterCommitted),
      afterPlanned: fromCents(afterPlanned),
      afterBestEffort: fromCents(afterPlanned + sum(reminders, day)),
    });
  }

  const events: RunwayResponse['events'] = [
    ...flows.map((f) => ({
      date: f.date,
      amount: fromCents(f.amountCents),
      kind: f.kind,
      label: f.label,
      committed: true,
    })),
    ...input.deals
      .filter((d) => diffDays(onOrAfter(d.date, today), today) <= horizonDays)
      .map((d) => ({
        date: onOrAfter(d.date, today),
        amount: fromCents(d.amountCents),
        kind:
          d.stage === 'PAID'
            ? ('DEAL_PAID' as const)
            : d.stage === 'REMINDER'
              ? ('INVOICE_DUE' as const)
              : ('DEAL_COMMITTED' as const),
        label: d.label,
        committed: d.stage === 'COMMITTED' || d.stage === 'PAID',
      })),
  ].sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? -1 : 1));

  return {
    currency: input.currency,
    today,
    asOf: input.balanceAsOf.toISOString(),
    balance: fromCents(base),
    planId: input.planId,
    deadline: input.deadline,
    gap: fromCents(input.gapCents),
    committed: fromCents(input.committedCents),
    bestEffort: fromCents(input.bestEffortCents),
    thresholds: flows
      .filter((f) => f.kind === 'PAYROLL' && f.amountCents < 0n)
      .map((f) => ({
        label: `Payroll ${formatMoney(-f.amountCents)}`,
        amount: fromCents(-f.amountCents),
        date: f.date,
      })),
    points,
    events,
  };
}
