/**
 * The planner (CONTEXT.md, "Planner rules"). Deterministic: the same inputs always give the same
 * plan, and every number is computed in code. The LLM only explains rows afterwards.
 *
 * 1. Candidates: for each contactable invoice that is not overdue, an offer at the opening
 *    discount for the full amount or a partial amount in $250 steps. A free reminder for every
 *    contactable invoice that is overdue or due by the deadline. Overdue invoices never get a
 *    discount.
 * 2. Objective: choose at most one offer per invoice whose committed cash (amount − discount),
 *    if all are accepted, covers target = G + B at the lowest total cost. Ties go, in order, to:
 *    fewest partial amounts; fewest dollar-days pulled forward; fewest clients contacted.
 * 3. Exact search: dynamic programming over committed cash (capped at the target) in $1 units
 *    (CONTEXT.md suggests $10; $1 is ten times finer and still fast). Each option's committed
 *    cash is rounded *down* to the unit, so any plan the search accepts truly covers the target
 *    in exact cents; the optimum is exact on that grid (see docs/decisions-core.md, D-014).
 * 4. Backups: the remaining eligible invoices, as full offers at the opening discount, ordered
 *    by cost, then dollar-days.
 */
import {
  type ActionType,
  type Bps,
  bpsToPercent,
  type Cents,
  diffDays,
  discountOn,
  dollars,
  formatMoney,
  impliedAnnualRate,
  type PlanItemRank,
  type PlanReasonCode,
} from '@terms/shared';

export interface PlannerInvoice {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientHasAgent: boolean;
  /** Amount still due. */
  amountDue: Cents;
  dueDate: string;
}

export interface PlannerInput {
  today: string;
  deadline: string;
  /** The owner's gap G. */
  gap: Cents;
  bufferBps: Bps;
  maxDiscountBps: Bps;
  openingDiscountBps: Bps;
  /** Client IDs never contacted (owner policy plus the goal). */
  doNotContact: readonly string[];
  invoices: readonly PlannerInvoice[];
  /** Partial amounts are multiples of this. Default $250. */
  partialStep?: Cents;
  /** Maximum number of backup rows. Default 10. */
  maxBackups?: number;
}

export interface PlannedRow {
  invoiceId: string;
  clientId: string;
  action: ActionType;
  rank: PlanItemRank;
  backupOrder: number | null;
  discountBps: Bps | null;
  amountEarly: Cents | null;
  payBy: string | null;
  daysEarly: number | null;
  impliedAnnualRate: string | null;
  cost: Cents;
  committedIfAgreed: Cents;
  /** False for reminders and NONE rows. */
  countsTowardGoal: boolean;
  reasonCode: PlanReasonCode;
  reason: string;
}

export interface PlanResult {
  target: Cents;
  buffer: Cents;
  /** One primary row per invoice, in input order, then backups by backupOrder. */
  rows: PlannedRow[];
  plannedCommitted: Cents;
  plannedCost: Cents;
  /** Sum of reminded invoices: best effort, never counted. */
  bestEffort: Cents;
  /** True when no combination of offers reaches the target; the plan then commits the most it can. */
  shortfall: boolean;
}

/** One way to ask for early payment on one invoice. */
export interface OfferOption {
  invoiceIndex: number;
  amountEarly: Cents;
  partial: boolean;
  cost: Cents;
  committed: Cents;
  /** amountEarly (whole dollars) × days early: the size of the ask. */
  dollarDays: bigint;
}

interface Score {
  cost: bigint;
  partials: number;
  dollarDays: bigint;
  clients: number;
}

const ZERO: Score = { cost: 0n, partials: 0, dollarDays: 0n, clients: 0 };

/** Lexicographic: cost, then partials, then dollar-days, then clients. */
export function compareScores(a: Score, b: Score): number {
  if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
  if (a.partials !== b.partials) return a.partials - b.partials;
  if (a.dollarDays !== b.dollarDays) return a.dollarDays < b.dollarDays ? -1 : 1;
  return a.clients - b.clients;
}

function addScore(s: Score, o: OfferOption): Score {
  return {
    cost: s.cost + o.cost,
    partials: s.partials + (o.partial ? 1 : 0),
    dollarDays: s.dollarDays + o.dollarDays,
    clients: s.clients + 1,
  };
}

const MAX_DP_STATES = 200_000;

/** Whole-dollar unit for the search: $1, or coarser for very large targets. */
export function searchUnit(target: Cents): Cents {
  let unit = dollars(1);
  while (target / unit > BigInt(MAX_DP_STATES)) unit *= 10n;
  return unit;
}

/** Every offer option for one invoice at a discount: partial steps below the amount, then the full amount. */
export function offerOptions(
  invoice: PlannerInvoice,
  invoiceIndex: number,
  discountBps: Bps,
  today: string,
  step: Cents,
): OfferOption[] {
  const days = diffDays(invoice.dueDate, today);
  if (days < 1 || invoice.amountDue <= 0n) return [];
  const make = (amount: Cents, partial: boolean): OfferOption => {
    const cost = discountOn(amount, discountBps);
    return {
      invoiceIndex,
      amountEarly: amount,
      partial,
      cost,
      committed: amount - cost,
      dollarDays: (amount / 100n) * BigInt(days),
    };
  };
  const options: OfferOption[] = [];
  for (let a = step; a < invoice.amountDue; a += step) options.push(make(a, true));
  options.push(make(invoice.amountDue, false));
  return options;
}

/**
 * Exact minimum-score selection of at most one option per group whose committed cash reaches
 * `target`. Returns null when no selection reaches it.
 */
export function cheapestCover(
  groups: readonly (readonly OfferOption[])[],
  target: Cents,
): OfferOption[] | null {
  if (target <= 0n) return [];
  const unit = searchUnit(target);
  const size = Number((target + unit - 1n) / unit); // states 0..size; `size` means "covered"
  let best: (Score | null)[] = new Array<Score | null>(size + 1).fill(null);
  best[0] = ZERO;
  // choice[g][u] = option index chosen in group g to reach state u (-1 = none), prev[g][u] = state before.
  const choices: Int32Array[] = [];
  const prevs: Int32Array[] = [];

  for (const group of groups) {
    const next = best.slice();
    const choice = new Int32Array(size + 1).fill(-1);
    const prev = new Int32Array(size + 1);
    for (let u = 0; u <= size; u++) prev[u] = u;
    for (let u = 0; u <= size; u++) {
      const base = best[u];
      if (base === null || base === undefined) continue;
      group.forEach((o, oi) => {
        const units = Number(o.committed / unit);
        const v = Math.min(size, u + units);
        const cand = addScore(base, o);
        const current = next[v];
        if (current === null || current === undefined || compareScores(cand, current) < 0) {
          next[v] = cand;
          choice[v] = oi;
          prev[v] = u;
        }
      });
    }
    choices.push(choice);
    prevs.push(prev);
    best = next;
  }

  if (best[size] === null) return null;
  const picked: OfferOption[] = [];
  let u = size;
  for (let g = groups.length - 1; g >= 0; g--) {
    const oi = at(at(choices, g), u);
    if (oi >= 0) {
      picked.push(at(at(groups, g), oi));
      u = at(at(prevs, g), u);
    }
  }
  return picked.reverse();
}

/** Indexed read that fails loudly instead of returning undefined (internal invariants only). */
function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`planner invariant: no element at ${index}`);
  return value;
}

function rowBase(inv: PlannerInvoice): Pick<PlannedRow, 'invoiceId' | 'clientId'> {
  return { invoiceId: inv.id, clientId: inv.clientId };
}

function noneRow(inv: PlannerInvoice, reasonCode: PlanReasonCode, reason: string): PlannedRow {
  return {
    ...rowBase(inv),
    action: 'NONE',
    rank: 'PRIMARY',
    backupOrder: null,
    discountBps: null,
    amountEarly: null,
    payBy: null,
    daysEarly: null,
    impliedAnnualRate: null,
    cost: 0n,
    committedIfAgreed: 0n,
    countsTowardGoal: false,
    reasonCode,
    reason,
  };
}

function offerRow(
  inv: PlannerInvoice,
  o: OfferOption,
  discountBps: Bps,
  today: string,
  rank: PlanItemRank,
  backupOrder: number | null,
  reasonCode: PlanReasonCode,
  reason: string,
): PlannedRow {
  const days = diffDays(inv.dueDate, today);
  const action: ActionType = inv.clientHasAgent
    ? 'NEGOTIATE'
    : o.partial
      ? 'PARTIAL_PAYMENT'
      : 'EARLY_DISCOUNT';
  return {
    ...rowBase(inv),
    action,
    rank,
    backupOrder,
    discountBps,
    amountEarly: o.amountEarly,
    payBy: today,
    daysEarly: days,
    impliedAnnualRate: impliedAnnualRate(discountBps, days),
    cost: o.cost,
    committedIfAgreed: o.committed,
    countsTowardGoal: true,
    reasonCode,
    reason,
  };
}

/** target = gap × (1 + buffer), rounded half up to the cent. */
export function targetFor(gap: Cents, bufferBps: Bps): { target: Cents; buffer: Cents } {
  const buffer = discountOn(gap, bufferBps);
  return { target: gap + buffer, buffer };
}

/** The stop rule: committed cash covers gap + buffer. */
export function isGoalMet(committed: Cents, target: Cents): boolean {
  return committed >= target;
}

export function buildPlan(input: PlannerInput): PlanResult {
  const step = input.partialStep ?? dollars(250);
  const maxBackups = input.maxBackups ?? 10;
  const opening = Math.min(input.openingDiscountBps, input.maxDiscountBps);
  const { target, buffer } = targetFor(input.gap, input.bufferBps);
  const pct = bpsToPercent(opening);

  const eligible: number[] = [];
  const groups: OfferOption[][] = [];
  input.invoices.forEach((inv, i) => {
    if (input.doNotContact.includes(inv.clientId) || inv.amountDue <= 0n) return;
    if (diffDays(inv.dueDate, input.today) < 1) return; // overdue or due today: no discount
    eligible.push(i);
    groups.push(offerOptions(inv, i, opening, input.today, step));
  });

  let chosen = cheapestCover(groups, target);
  const shortfall = chosen === null;
  // Cannot reach the target: ask every eligible client for the full amount (commits the most).
  chosen ??= groups.map((g) => g[g.length - 1]).filter((o): o is OfferOption => o !== undefined);
  const chosenByInvoice = new Map(chosen.map((o) => [o.invoiceIndex, o]));
  const targetText = formatMoney(target);

  const primary: PlannedRow[] = input.invoices.map((inv, i) => {
    if (inv.amountDue <= 0n) return noneRow(inv, 'ALREADY_PAID', 'Already paid in full.');
    if (input.doNotContact.includes(inv.clientId)) {
      return noneRow(inv, 'DO_NOT_CONTACT', 'On your do-not-contact list; never messaged.');
    }
    const o = chosenByInvoice.get(i);
    if (o !== undefined) {
      const reason = o.partial
        ? `Ask for ${formatMoney(o.amountEarly)} of ${formatMoney(inv.amountDue)} at ${pct}%: commits ${formatMoney(o.committed)} for ${formatMoney(o.cost)}, just enough with the other offers to reach ${targetText}.`
        : `Full ${formatMoney(o.amountEarly)} at ${pct}%: commits ${formatMoney(o.committed)} for ${formatMoney(o.cost)}, part of the cheapest way to reach ${targetText}.`;
      return offerRow(
        inv,
        o,
        opening,
        input.today,
        'PRIMARY',
        null,
        o.partial ? 'PARTIAL_TO_FIT_GAP' : 'CHEAPEST_COVER',
        shortfall ? `${reason} Even every offer together falls short of the target.` : reason,
      );
    }
    const daysToDue = diffDays(inv.dueDate, input.today);
    if (daysToDue < 0 || diffDays(inv.dueDate, input.deadline) <= 0) {
      const overdue = daysToDue < 0;
      const row = noneRow(
        inv,
        overdue ? 'REMINDER_OVERDUE' : 'REMINDER_DUE_BEFORE_DEADLINE',
        overdue
          ? `${-daysToDue} day${daysToDue === -1 ? '' : 's'} overdue: a free reminder. Best effort, not counted.`
          : 'Due by the deadline: a free reminder. Best effort, not counted.',
      );
      return { ...row, action: 'REMINDER' };
    }
    return noneRow(inv, 'NOT_NEEDED', 'Not needed to reach the goal.');
  });

  const backupCandidates = eligible
    .filter((i) => !chosenByInvoice.has(i))
    .map((i) => {
      const group = groups[eligible.indexOf(i)] ?? [];
      return group[group.length - 1];
    })
    .filter((o): o is OfferOption => o !== undefined)
    .sort((a, b) =>
      compareScores(
        { cost: a.cost, partials: 0, dollarDays: a.dollarDays, clients: 1 },
        { cost: b.cost, partials: 0, dollarDays: b.dollarDays, clients: 1 },
      ),
    )
    .slice(0, maxBackups);

  const backups = backupCandidates.map((o, k) => {
    const inv = at(input.invoices, o.invoiceIndex);
    return offerRow(
      inv,
      o,
      opening,
      input.today,
      'BACKUP',
      k + 1,
      'BACKUP',
      `Backup ${k + 1}: full ${formatMoney(o.amountEarly)} at ${pct}% if an offer is declined.`,
    );
  });

  const offers = primary.filter((r) => r.countsTowardGoal);
  return {
    target,
    buffer,
    rows: [...primary, ...backups],
    plannedCommitted: offers.reduce((s, r) => s + r.committedIfAgreed, 0n),
    plannedCost: offers.reduce((s, r) => s + r.cost, 0n),
    bestEffort: primary
      .filter((r) => r.action === 'REMINDER')
      .reduce(
        (s, r) => s + (input.invoices.find((x) => x.id === r.invoiceId)?.amountDue ?? 0n),
        0n,
      ),
    shortfall,
  };
}
