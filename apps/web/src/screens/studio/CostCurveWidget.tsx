import { type AgCartesianChartOptions } from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import {
  type AgBaseWidgetDefinition,
  type AgWidgetData,
  type AgWidgetDataFormat,
  type AgWidgetFieldReference,
  type AgWidgetParams,
} from 'ag-studio';
import { useEffect, useId, useMemo, useState } from 'react';
import '../../charts/setup';
import { CHART_COLORS } from '../../charts/palette';
import { costCurvePoints, type CurveRow, describeCostCurve } from './costCurve';

export const COST_CURVE = 'cost-cash-curve';

export interface CostCurveDataMapping {
  label: AgWidgetFieldReference[];
  cost: AgWidgetFieldReference[];
  cash: AgWidgetFieldReference[];
}

export interface CostCurve extends AgWidgetData<
  CostCurveDataMapping,
  AgWidgetDataFormat<undefined>
> {
  type: typeof COST_CURVE;
}

const CHART_STYLE = { height: '100%' };

/** A point's name from Studio's row: text or a number, and nothing else. */
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const dollars = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Reads the mapped fields from Studio and draws the curve. Studio applies the page's filters. */
export function CostCurveWidget({ dataMapping, format, widgetApi }: AgWidgetParams<CostCurve>) {
  const descriptionId = useId();
  const [rows, setRows] = useState<CurveRow[] | null>(null);
  const label = dataMapping.label?.[0];
  const cost = dataMapping.cost?.[0];
  const cash = dataMapping.cash?.[0];

  useEffect(() => {
    if (!label || !cost || !cash) {
      widgetApi.setDisplayState('incompleteDataMapping');
      return;
    }
    let live = true;
    const read = (found: Record<string, unknown>[]) => {
      setRows(
        found.map((row) => ({
          label: text(row[label.key]),
          cost: Number(row[cost.key] ?? 0),
          cash: Number(row[cash.key] ?? 0),
        })),
      );
      widgetApi.setDisplayState(found.length > 0 ? 'displayed' : 'noData');
    };
    widgetApi.setDisplayState('loading');
    void widgetApi
      .getData(
        { kind: 'flat', fields: [label, cost, cash] },
        {
          queryId: 'curve',
          onDataUpdated: (response) => {
            if (live && !response.replaced) read(response.results.rows);
          },
        },
      )
      .then((response) => {
        if (live && !response.replaced) read(response.results.rows);
      });
    return () => {
      live = false;
    };
  }, [label, cost, cash, widgetApi]);

  const points = useMemo(() => costCurvePoints(rows ?? []), [rows]);
  const options = useMemo<AgCartesianChartOptions>(
    () => ({
      data: points,
      background: { visible: false },
      series: [
        {
          type: 'line',
          xKey: 'cash',
          yKey: 'cost',
          xName: 'Cash in',
          yName: 'Discount cost',
          stroke: CHART_COLORS.committed,
          marker: { fill: CHART_COLORS.committed, size: 7 },
          tooltip: {
            renderer: ({ datum }: { datum: (typeof points)[number] }) => ({
              heading: datum.label,
              data: [
                { label: 'Cash in', value: dollars(datum.cash) },
                { label: 'Discount cost', value: dollars(datum.cost) },
              ],
            }),
          },
        },
      ],
      axes: {
        x: {
          type: 'number',
          position: 'bottom',
          title: { text: 'Cash brought in' },
          label: { formatter: ({ value }: { value: number }) => dollars(value) },
        },
        y: {
          type: 'number',
          position: 'left',
          title: { text: 'Discount cost' },
          label: { formatter: ({ value }: { value: number }) => dollars(value) },
        },
      },
    }),
    [points],
  );

  if (rows === null) return null;
  // A custom widget draws its own title, when the strategist or the owner has set one.
  const title = format?.title?.enabled !== false && format?.title?.text ? format.title.text : null;
  return (
    <div
      role="group"
      // Studio's own frame is already a group named by the title; this one names the chart.
      aria-label="Cost versus cash chart"
      aria-describedby={descriptionId}
      className="flex h-full w-full flex-col"
    >
      {title ? <p className="px-2 pt-1 text-lg text-ink">{title}</p> : null}
      <p id={descriptionId} className="sr-only">
        {describeCostCurve(points)}
      </p>
      <div className="min-h-0 flex-1">
        <AgCharts options={options} style={CHART_STYLE} />
      </div>
    </div>
  );
}

/** How Studio knows the widget: its data, its settings form, and what the strategist is told. */
export const costCurveDefinition: AgBaseWidgetDefinition<typeof COST_CURVE, CostCurve> = {
  id: COST_CURVE,
  label: 'Cost vs cash',
  icon: { className: 'ag-studio-icon-line-chart' },
  dataMapping: {
    label: {
      type: 'field',
      supportedRoles: ['category'],
      required: true,
      aiDescription: 'What each point is, such as the client.',
    },
    cost: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      required: true,
      aiDescription: 'The discount the plan gives up for this row, such as invoices.planCost.',
    },
    cash: {
      type: 'field',
      supportedRoles: ['numeric'],
      requires: { cardinality: 'one' },
      required: true,
      aiDescription: 'The cash this row brings in early, such as invoices.planCash.',
    },
  },
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: 'label', label: 'Point' },
        { key: 'cost', label: 'Cost' },
        { key: 'cash', label: 'Cash' },
      ],
    }),
  comp: CostCurveWidget,
  defaultSize: { width: 12, height: 8 },
  minSize: { width: 4, height: 4 },
  ai: {
    label: 'Cost versus cash curve',
    description:
      'The plan’s rows from the cheapest cash to the dearest, with running totals of cash brought in and discount cost.',
    usage:
      'Use to show what each extra dollar of early cash costs. Map label to invoices.client, cost to invoices.planCost and cash to invoices.planCash.',
  },
};
