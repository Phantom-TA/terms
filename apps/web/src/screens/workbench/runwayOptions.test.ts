import { beforeEach, describe, expect, it } from 'vitest';
import { CHART_COLORS } from '../../charts/palette';
import { MockWorld } from '../../mocks/world';
import { buildRunwayOptions, describeRunway, localDate, toChartRows } from './runwayOptions';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

let world: MockWorld;
beforeEach(() => {
  world = new MockWorld();
  world.parseGoal(SENTENCE);
  world.createPlan();
});

describe('localDate', () => {
  it('is the same calendar day in any time zone', () => {
    const date = localDate('2026-11-13');
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 10, 13]);
  });
});

describe('toChartRows', () => {
  it('keeps the server’s exact text beside each plottable number', () => {
    const rows = toChartRows(world.runway());
    expect(rows).toHaveLength(31);
    const friday = rows.find((r) => r.iso === '2026-11-13')!;
    expect(friday).toMatchObject({
      before: -6200,
      beforeText: '-6200.00',
      afterPlanned: 496,
      afterPlannedText: '496.00',
      afterCommittedText: '-6200.00',
    });
  });
});

describe('buildRunwayOptions', () => {
  it('draws committed cash and best-effort reminders as separate series', () => {
    const series = buildRunwayOptions(world.runway()).series as {
      yKey: string;
      yName: string;
      stroke: string;
      lineDash?: number[];
    }[];
    expect(series.map((s) => s.yKey)).toEqual([
      'before',
      'afterPlanned',
      'afterBestEffort',
      'afterCommitted',
    ]);
    const committed = series.find((s) => s.yKey === 'afterCommitted')!;
    expect(committed).toMatchObject({ yName: 'Committed', stroke: CHART_COLORS.committed });
    expect(committed.lineDash).toBeUndefined();
    const bestEffort = series.find((s) => s.yKey === 'afterBestEffort')!;
    expect(bestEffort.yName).toBe('Best effort, not counted');
    expect(bestEffort.lineDash).toBeDefined();
    expect(bestEffort.stroke).not.toBe(CHART_COLORS.committed);
  });

  it('uses the accent only for committed cash', () => {
    const series = buildRunwayOptions(world.runway()).series as { yKey: string; stroke: string }[];
    expect(series.filter((s) => s.stroke === CHART_COLORS.committed).map((s) => s.yKey)).toEqual([
      'afterCommitted',
    ]);
  });

  interface Line {
    value: number | Date;
    stroke: string;
    label?: { text: string };
  }
  const axes = (options: ReturnType<typeof buildRunwayOptions>) =>
    options.axes as unknown as {
      x: { crossLines?: Line[] };
      y: { crossLines: Line[]; max?: number };
    };

  it('draws payroll as a labelled horizontal line at the server’s amount', () => {
    const [payroll] = axes(buildRunwayOptions(world.runway())).y.crossLines;
    expect(payroll).toMatchObject({
      value: 11400,
      stroke: CHART_COLORS.danger,
      label: { text: 'Payroll $11,400.00 · Fri, Nov 13' },
    });
  });

  it('marks the day payroll lands, quietly', () => {
    const lines = axes(buildRunwayOptions(world.runway())).x.crossLines!;
    expect(lines).toHaveLength(1);
    expect((lines[0]?.value as Date).getDate()).toBe(13);
    expect(lines[0]?.stroke).not.toBe(CHART_COLORS.danger);
    expect(lines[0]?.label).toBeUndefined();
  });

  it('keeps red for payroll alone, and marks zero cash in neutral', () => {
    const lines = axes(buildRunwayOptions(world.runway())).y.crossLines;
    expect(lines[1]).toMatchObject({ value: 0, label: { text: 'No cash' } });
    expect(lines[1]?.stroke).not.toBe(CHART_COLORS.danger);
  });

  it('widens the axis when payroll is above every balance, so the line is on the chart', () => {
    const fresh = new MockWorld();
    const y = axes(buildRunwayOptions(fresh.runway())).y;
    expect(y.max).toBeGreaterThan(11400);
    // With the plan, a balance is above payroll and the axis finds its own top.
    expect(axes(buildRunwayOptions(world.runway())).y.max).toBeUndefined();
  });

  it('draws no payroll line when the server reports no threshold', () => {
    const lines = axes(buildRunwayOptions({ ...world.runway(), thresholds: [] }));
    expect(lines.x.crossLines).toBeUndefined();
    expect(lines.y.crossLines).toHaveLength(1);
  });

  it('turns on throwing validations only when asked, for development', () => {
    expect(buildRunwayOptions(world.runway())).not.toHaveProperty('validations');
    expect(buildRunwayOptions(world.runway(), { strictValidation: true })).toHaveProperty(
      'validations',
    );
  });

  it('explains each point in a tooltip using the exact server text', () => {
    const options = buildRunwayOptions(world.runway());
    const series = options.series as unknown as {
      tooltip: {
        renderer: (p: { datum: unknown; yKey: string; yName: string }) => {
          heading: string;
          data: { label: string; value: string }[];
        };
      };
    }[];
    const row = toChartRows(world.runway()).find((r) => r.iso === '2026-11-13');
    const rendered = series[0]!.tooltip.renderer({
      datum: row,
      yKey: 'before',
      yName: 'Before the plan',
    });
    expect(rendered).toEqual({
      heading: 'Fri, Nov 13',
      data: [{ label: 'Before the plan', value: '-$6,200.00' }],
    });
  });
});

describe('describeRunway', () => {
  it('describes payroll day from the server’s figures', () => {
    expect(describeRunway(world.runway())).toBe(
      'Cash runway chart. Payroll of $11,400.00 lands Fri, Nov 13. On that day the balance is -$6,200.00 with no plan, $496.00 if every offer is accepted, and -$6,200.00 from committed cash so far.',
    );
  });

  it('copes with no threshold', () => {
    expect(describeRunway({ ...world.runway(), thresholds: [] })).toMatch(
      /No payroll or other threshold/,
    );
  });
});
