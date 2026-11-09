import { formatMoney, fromCents, type RunwayResponse } from '@terms/shared';
import { type AgCartesianChartOptions } from 'ag-charts-community';
import { CHART_COLORS } from '../../charts/palette';
import { formatDate } from '../../lib/display';

/** "2026-11-13" as a local calendar date, so the axis never shows the day before. */
export function localDate(iso: string): Date {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

type SeriesKey = 'before' | 'afterPlanned' | 'afterBestEffort' | 'afterCommitted';

/** One chart row: a plottable number per series, and the server's exact text for the tooltip. */
type ChartRow = { date: Date; iso: string } & Record<SeriesKey, number> &
  Record<`${SeriesKey}Text`, string>;

export function toChartRows(runway: RunwayResponse): ChartRow[] {
  return runway.points.map((point) => ({
    date: localDate(point.date),
    iso: point.date,
    before: Number(point.before),
    afterPlanned: Number(point.afterPlanned),
    afterBestEffort: Number(point.afterBestEffort),
    afterCommitted: Number(point.afterCommitted),
    beforeText: point.before,
    afterPlannedText: point.afterPlanned,
    afterBestEffortText: point.afterBestEffort,
    afterCommittedText: point.afterCommitted,
  }));
}

/** Axis ticks. Only for labels: tooltips and the summary use the server's exact strings. */
function tickLabel(value: number): string {
  return formatMoney(fromCents(BigInt(Math.round(value * 100))), { cents: 'auto' });
}

interface TooltipParams {
  datum: unknown;
  yKey: string;
  yName?: string;
}

function tooltip({ datum, yKey, yName }: TooltipParams) {
  const row = datum as Partial<ChartRow>;
  const text = (row as Record<string, string | undefined>)[`${yKey}Text`];
  return {
    heading: row.iso ? formatDate(row.iso) : '',
    data: [{ label: yName ?? yKey, value: text ? formatMoney(text) : '' }],
  };
}

const SERIES: readonly {
  key: SeriesKey;
  name: string;
  stroke: string;
  strokeWidth: number;
  lineDash?: number[];
}[] = [
  { key: 'before', name: 'Before the plan', stroke: CHART_COLORS.before, strokeWidth: 2 },
  {
    key: 'afterPlanned',
    name: 'If every offer is accepted',
    stroke: CHART_COLORS.planned,
    strokeWidth: 2,
    lineDash: [6, 4],
  },
  {
    key: 'afterBestEffort',
    name: 'With reminders paid (best effort, not counted)',
    stroke: CHART_COLORS.bestEffort,
    strokeWidth: 2,
    lineDash: [2, 3],
  },
  { key: 'afterCommitted', name: 'Committed', stroke: CHART_COLORS.committed, strokeWidth: 3 },
];

/**
 * The runway chart: balance each day before the plan and after it, with committed cash and
 * best-effort reminders drawn as separate lines, and a labelled line where payroll lands.
 * Every value is the server's; nothing is projected here.
 */
export function buildRunwayOptions(
  runway: RunwayResponse,
  options: { strictValidation?: boolean } = {},
): AgCartesianChartOptions {
  const payroll = runway.thresholds[0] ?? null;
  return {
    data: toChartRows(runway),
    background: { fill: 'transparent' },
    legend: { position: 'bottom' },
    series: SERIES.map((s) => ({
      type: 'line' as const,
      xKey: 'date',
      yKey: s.key,
      yName: s.name,
      stroke: s.stroke,
      strokeWidth: s.strokeWidth,
      ...(s.lineDash ? { lineDash: s.lineDash } : {}),
      marker: { enabled: false },
      tooltip: { renderer: tooltip },
    })),
    axes: {
      x: {
        type: 'time' as const,
        position: 'bottom' as const,
        label: { format: '%b %d' },
        ...(payroll
          ? {
              crossLines: [
                {
                  type: 'line' as const,
                  value: localDate(payroll.date),
                  stroke: CHART_COLORS.danger,
                  strokeWidth: 2,
                  lineDash: [6, 4],
                  label: {
                    text: `${payroll.label} ${formatMoney(payroll.amount)} · ${formatDate(payroll.date)}`,
                    placement: 'top' as const,
                    color: CHART_COLORS.danger,
                    fontWeight: 'bold' as const,
                  },
                },
              ],
            }
          : {}),
      },
      y: {
        type: 'number' as const,
        position: 'left' as const,
        label: { formatter: ({ value }: { value: number }) => tickLabel(value) },
        crossLines: [
          {
            type: 'line' as const,
            value: 0,
            stroke: CHART_COLORS.danger,
            strokeWidth: 1,
            label: {
              text: 'No cash',
              placement: 'right' as const,
              color: CHART_COLORS.danger,
            },
          },
        ],
      },
    },
    ...(options.strictValidation
      ? { validations: { throwOn: ['error', 'warning', 'deprecation'] as const } }
      : {}),
  } as AgCartesianChartOptions;
}

/**
 * One plain-language line for screen readers, from the server's own figures: where the runway
 * stands on the day payroll lands, before the plan, if every offer is accepted, and committed.
 */
export function describeRunway(runway: RunwayResponse): string {
  const payroll = runway.thresholds[0];
  if (!payroll) return 'Cash runway chart. No payroll or other threshold falls in this period.';
  const day = runway.points.find((p) => p.date === payroll.date);
  if (!day)
    return `Cash runway chart. ${payroll.label} of ${formatMoney(payroll.amount)} lands ${formatDate(payroll.date)}.`;
  return [
    `Cash runway chart. ${payroll.label} of ${formatMoney(payroll.amount)} lands ${formatDate(payroll.date)}.`,
    `On that day the balance is ${formatMoney(day.before)} with no plan,`,
    `${formatMoney(day.afterPlanned)} if every offer is accepted,`,
    `and ${formatMoney(day.afterCommitted)} from committed cash so far.`,
  ].join(' ');
}
