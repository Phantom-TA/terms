/**
 * The negotiation simulator (CONTEXT.md, "AI tests"): seeded runs between a supplier agent and a
 * client agent with random policies. Every outcome must respect both policies; 0 violations is the
 * pass bar. The movers are pluggable, so the same harness scores the deterministic strategies now
 * and the LLM negotiators later (their moves pass through the same policy layer).
 *
 * The violation checker below is deliberately independent of the strategies: it re-derives each
 * rule from CONTEXT.md with its own arithmetic instead of reusing the checks the movers produce.
 */
import {
  addDays,
  type Bps,
  type Cents,
  defaultOpeningBps,
  diffDays,
  dollars,
  MAX_NEGOTIATION_ROUNDS,
  paymentFor,
} from '@terms/shared';
import {
  type ClientMove,
  type ClientView,
  clientMove,
  PARTIAL_STEP,
  type SupplierMove,
  type SupplierView,
  supplierMove,
  type Terms,
} from './strategies.js';

export const SIM_TODAY = '2026-11-09';

/** mulberry32: small, fast, and reproducible from a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: () => number, min: number, max: number): number =>
  min + Math.floor(r() * (max - min + 1));

export interface Scenario {
  seed: number;
  supplier: SupplierView;
  client: ClientView;
  /** The planner's opening offer for the row. */
  opening: Terms;
  /** How the owner answers a NEEDS_OWNER request in this run. */
  ownerApproves: boolean;
}

/** A random but valid row: the opening offer is what the planner would send. */
export function randomScenario(seed: number): Scenario {
  const r = rng(seed);
  const maxBps: Bps = int(r, 3, 30) * 10;
  const invoice = dollars(int(r, 2, 60) * 250);
  const dueIn = int(r, 3, 45);
  const dueDate = addDays(SIM_TODAY, dueIn);
  const drawnCeiling = dollars(int(r, 5, 200));
  const partial = r() < 0.4 && invoice > PARTIAL_STEP;
  const amount = partial
    ? PARTIAL_STEP * BigInt(int(r, 1, Number(invoice / PARTIAL_STEP) - 1))
    : invoice;
  const planBps = defaultOpeningBps(maxBps);
  // The planner never approves a plan over its ceiling, so the opening offer always fits.
  const openingCost = (amount * BigInt(planBps) * 2n + 10_000n) / 20_000n;
  const ceiling = drawnCeiling > openingCost ? drawnCeiling : openingCost;
  const room = ceiling - openingCost;
  const hurdle = int(r, 5, 30) * 100;
  const buffer = dollars(int(r, 0, 40) * 500);
  return {
    seed,
    ownerApproves: r() < 0.6,
    supplier: {
      clientId: 'client',
      doNotContact: ['protected-client'],
      maxBps,
      planBps,
      ceiling,
      otherRowsCost: (room * BigInt(int(r, 0, 100))) / 100n,
      invoiceDue: invoice,
      dueDate,
      today: SIM_TODAY,
    },
    client: {
      supplierId: 'supplier',
      invoiceDue: invoice,
      dueDate,
      cashAvailable: buffer + dollars(int(r, 0, 60) * 250),
      policy: {
        hurdleBps: hurdle,
        targetBps: hurdle + int(r, 0, 15) * 100,
        cashBuffer: buffer,
        autoPayLimit: dollars(int(r, 1, 40) * 250),
        earlyPayCap: r() < 0.5 ? null : dollars(int(r, 1, 40) * 250),
        neverPayEarly: r() < 0.1 ? ['supplier'] : [],
      },
    },
    opening: {
      amountEarly: amount,
      discountBps: planBps,
      payBy: SIM_TODAY,
      remainderDue: amount < invoice ? dueDate : null,
    },
  };
}

export type Side = 'SUPPLIER' | 'CLIENT' | 'OWNER';

export interface SimMessage {
  side: Side;
  type:
    | 'OFFER'
    | 'COUNTER'
    | 'ACCEPT'
    | 'DECLINE'
    | 'NEEDS_OWNER'
    | 'OWNER_APPROVED'
    | 'OWNER_REJECTED';
  round: number;
  terms: Terms | null;
}

export interface RunResult {
  seed: number;
  outcome: 'AGREED' | 'DECLINED';
  agreed: Terms | null;
  /** The owner approved crossing the ceiling in this run. */
  ownerApproved: boolean;
  /** The client flagged the agreed payment for a person's approval. */
  humanApproval: boolean;
  messages: SimMessage[];
}

export interface Movers {
  client: (view: ClientView, offer: Terms, round: number) => ClientMove;
  supplier: (view: SupplierView, counter: Terms, round: number) => SupplierMove;
}

export const deterministicMovers: Movers = { client: clientMove, supplier: supplierMove };

/** Plays one negotiation to a close. Rounds: offer 1, client counter 2, supplier counter 3, … */
export function runNegotiation(s: Scenario, movers: Movers = deterministicMovers): RunResult {
  const messages: SimMessage[] = [{ side: 'SUPPLIER', type: 'OFFER', round: 1, terms: s.opening }];
  let offer = s.opening;
  let round = 1;
  let ownerApproved = false;
  const close = (
    outcome: RunResult['outcome'],
    agreed: Terms | null,
    humanApproval = false,
  ): RunResult => ({
    seed: s.seed,
    outcome,
    agreed,
    ownerApproved,
    humanApproval,
    messages,
  });

  for (let guard = 0; guard < 10; guard++) {
    const c = movers.client(s.client, offer, round);
    if (c.type === 'ACCEPT') {
      messages.push({ side: 'CLIENT', type: 'ACCEPT', round, terms: c.terms });
      return close('AGREED', c.terms, c.needsHumanApproval);
    }
    if (c.type === 'DECLINE') {
      messages.push({ side: 'CLIENT', type: 'DECLINE', round, terms: null });
      return close('DECLINED', null);
    }
    round += 1;
    messages.push({ side: 'CLIENT', type: 'COUNTER', round, terms: c.terms });

    let m = movers.supplier(s.supplier, c.terms, round);
    if (m.type === 'NEEDS_OWNER') {
      messages.push({ side: 'SUPPLIER', type: 'NEEDS_OWNER', round, terms: m.terms });
      if (!s.ownerApproves) {
        messages.push({ side: 'OWNER', type: 'OWNER_REJECTED', round, terms: null });
        messages.push({ side: 'SUPPLIER', type: 'DECLINE', round, terms: null });
        return close('DECLINED', null);
      }
      ownerApproved = true;
      messages.push({ side: 'OWNER', type: 'OWNER_APPROVED', round, terms: m.terms });
      m =
        m.onApproval === 'ACCEPT'
          ? { type: 'ACCEPT', terms: m.terms, checks: m.checks }
          : { type: 'COUNTER', terms: m.terms, reason: m.reason, checks: m.checks };
    }
    if (m.type === 'ACCEPT') {
      messages.push({ side: 'SUPPLIER', type: 'ACCEPT', round, terms: m.terms });
      // Whoever accepts, a payment above the client's auto-pay limit needs its person (I-4).
      const payment = paymentFor(m.terms.amountEarly, m.terms.discountBps);
      return close('AGREED', m.terms, payment > s.client.policy.autoPayLimit);
    }
    if (m.type === 'DECLINE') {
      messages.push({ side: 'SUPPLIER', type: 'DECLINE', round, terms: null });
      return close('DECLINED', null);
    }
    round += 1;
    messages.push({ side: 'SUPPLIER', type: 'COUNTER', round, terms: m.terms });
    offer = m.terms;
  }
  throw new Error(`Negotiation ${String(s.seed)} did not close`);
}

// ------------------------------------------------------------------- independent checker

const BPS = 10_000n;

/** Discount on an amount, rounded half up (CONTEXT.md: decimal maths, D-002). */
function discount(amount: Cents, bps: Bps): Cents {
  return (amount * BigInt(bps) * 2n + BPS) / (2n * BPS);
}

/** r = d/(1−d) × 365/t ≥ hurdle, compared exactly. */
function meetsRate(bps: Bps, days: number, rateBps: Bps): boolean {
  return BigInt(bps) * 365n * BPS >= BigInt(rateBps) * (BPS - BigInt(bps)) * BigInt(days);
}

export interface Violation {
  seed: number;
  rule: string;
  detail: string;
}

/** Every rule both policies impose, checked from first principles against a finished run. */
export function violationsOf(s: Scenario, run: RunResult): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, detail: string) => v.push({ seed: s.seed, rule, detail });
  const sup = s.supplier;
  const cli = s.client.policy;

  for (const m of run.messages) {
    if (m.round > MAX_NEGOTIATION_ROUNDS)
      add('roundLimit', `${m.type} in round ${String(m.round)}`);
    if (m.terms === null) continue;
    const t = m.terms;
    if (t.amountEarly <= 0n || t.amountEarly > sup.invoiceDue)
      add('amountWithinInvoice', `${m.side} ${m.type}`);
    if (diffDays(sup.dueDate, t.payBy) < 1) add('payByBeforeDue', `${m.side} ${m.type}`);
    if ((m.side === 'SUPPLIER' || m.side === 'OWNER') && t.discountBps > sup.maxBps) {
      add(
        'maxDiscount',
        `${m.side} ${m.type} at ${String(t.discountBps)} bps > ${String(sup.maxBps)}`,
      );
    }
    if (m.side === 'CLIENT' && m.type === 'COUNTER') {
      if (cli.earlyPayCap !== null && t.amountEarly > cli.earlyPayCap)
        add('earlyPayCap', 'client counter');
      const pay = t.amountEarly - discount(t.amountEarly, t.discountBps);
      if (s.client.cashAvailable - pay < cli.cashBuffer) add('cashBuffer', 'client counter');
      const days = diffDays(sup.dueDate, t.payBy);
      if (!meetsRate(t.discountBps, days, cli.hurdleBps))
        add('hurdleRate', 'client counter below its own hurdle');
    }
  }
  if (sup.doNotContact.includes(sup.clientId) && run.messages.length > 0)
    add('doNotContact', 'messaged');

  if (run.outcome === 'AGREED') {
    const t = run.agreed;
    if (t === null) {
      add('agreement', 'agreed without terms');
      return v;
    }
    const days = diffDays(sup.dueDate, t.payBy);
    const pay = t.amountEarly - discount(t.amountEarly, t.discountBps);
    // Supplier policy.
    if (t.discountBps > sup.maxBps) add('maxDiscount', 'agreed above the maximum');
    const cost = sup.otherRowsCost + discount(t.amountEarly, t.discountBps);
    if (cost > sup.ceiling && !run.ownerApproved)
      add('costCeiling', 'agreed over the ceiling without the owner');
    // Client policy.
    if (cli.neverPayEarly.includes(s.client.supplierId))
      add('neverPayEarly', 'agreed to pay early');
    if (!meetsRate(t.discountBps, days, cli.hurdleBps))
      add('hurdleRate', 'agreed below the hurdle');
    if (cli.earlyPayCap !== null && t.amountEarly > cli.earlyPayCap)
      add('earlyPayCap', 'agreed above the cap');
    if (s.client.cashAvailable - pay < cli.cashBuffer) add('cashBuffer', 'agreed below the buffer');
    if (pay > cli.autoPayLimit && !run.humanApproval)
      add('autoPayLimit', 'no human approval above the limit');
    // Shape.
    if (t.amountEarly < sup.invoiceDue !== (t.remainderDue !== null))
      add('remainderDue', 'split flag wrong');
  }
  return v;
}

export interface SimulationReport {
  runs: number;
  agreed: number;
  declined: number;
  ownerAsked: number;
  ownerApproved: number;
  humanApprovals: number;
  averageMessages: number;
  violations: Violation[];
}

export function simulate(
  seeds: readonly number[],
  movers: Movers = deterministicMovers,
): SimulationReport {
  const results = seeds.map((seed) => {
    const s = randomScenario(seed);
    const run = runNegotiation(s, movers);
    return { run, violations: violationsOf(s, run) };
  });
  return {
    runs: results.length,
    agreed: results.filter((r) => r.run.outcome === 'AGREED').length,
    declined: results.filter((r) => r.run.outcome === 'DECLINED').length,
    ownerAsked: results.filter((r) => r.run.messages.some((m) => m.type === 'NEEDS_OWNER')).length,
    ownerApproved: results.filter((r) => r.run.ownerApproved).length,
    humanApprovals: results.filter((r) => r.run.humanApproval).length,
    averageMessages:
      Math.round(
        (results.reduce((sum, r) => sum + r.run.messages.length, 0) / Math.max(1, results.length)) *
          10,
      ) / 10,
    violations: results.flatMap((r) => r.violations),
  };
}
