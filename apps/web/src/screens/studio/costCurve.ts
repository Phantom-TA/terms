import { formatMoney } from '@terms/shared';

/**
 * The plan's cost-versus-cash curve: the plan's rows from the cheapest cash to the dearest, each
 * adding its cash and its cost to the running totals. The figures are the server's, per row; this
 * only orders and adds them up for the chart, the way the planner ranks offers.
 */

export interface CurveRow {
  label: string;
  cost: number;
  cash: number;
}

export interface CurvePoint {
  label: string;
  /** Cash so far, if every offer up to this one is accepted. */
  cash: number;
  /** Discount cost so far. */
  cost: number;
}

/** Rows that bring in no cash are left out: they have no place on a cost-per-dollar curve. */
export function costCurvePoints(rows: readonly CurveRow[]): CurvePoint[] {
  const priced = rows
    .filter((row) => row.cash > 0 && Number.isFinite(row.cost))
    .toSorted((a, b) => a.cost / a.cash - b.cost / b.cash || a.label.localeCompare(b.label));
  const points: CurvePoint[] = [{ label: 'Start', cash: 0, cost: 0 }];
  let cash = 0;
  let cost = 0;
  for (const row of priced) {
    // Whole cents, so the running totals don't pick up floating-point dust.
    cash = Math.round((cash + row.cash) * 100) / 100;
    cost = Math.round((cost + row.cost) * 100) / 100;
    points.push({ label: row.label, cash, cost });
  }
  return points;
}

const money = (value: number) => formatMoney(value.toFixed(2));

/** The curve in words, for screen readers. */
export function describeCostCurve(points: readonly CurvePoint[]): string {
  const steps = points.slice(1);
  const last = steps.at(-1);
  if (!last) return 'No plan rows bring in cash yet.';
  const each = steps.map((p) => `${p.label}: ${money(p.cash)} for ${money(p.cost)}`).join('; ');
  return `Cheapest cash first. ${each}. In all, ${money(last.cash)} for ${money(last.cost)}.`;
}
