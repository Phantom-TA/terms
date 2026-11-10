import { describe, expect, it } from 'vitest';
import { costCurvePoints, describeCostCurve } from './costCurve';

describe('the cost-versus-cash curve', () => {
  it('adds the plan rows from the cheapest cash to the dearest, from zero', () => {
    const points = costCurvePoints([
      { label: 'Juniper Labs', cost: 40, cash: 4960 },
      { label: 'Harbor & Co', cost: 21, cash: 1729 },
    ]);
    expect(points).toEqual([
      { label: 'Start', cash: 0, cost: 0 },
      { label: 'Juniper Labs', cash: 4960, cost: 40 },
      { label: 'Harbor & Co', cash: 6689, cost: 61 },
    ]);
  });

  it('leaves out rows that bring in no cash, such as reminders', () => {
    const points = costCurvePoints([
      { label: 'Oak Street', cost: 0, cash: 0 },
      { label: 'Harbor & Co', cost: 21, cash: 1729 },
    ]);
    expect(points.map((p) => p.label)).toEqual(['Start', 'Harbor & Co']);
  });

  it('keeps running totals to whole cents', () => {
    const points = costCurvePoints([
      { label: 'A', cost: 0.1, cash: 100.1 },
      { label: 'B', cost: 0.2, cash: 100.2 },
    ]);
    expect(points.at(-1)).toMatchObject({ cash: 200.3, cost: 0.3 });
  });

  it('puts the curve in words, or says there is nothing to draw', () => {
    expect(describeCostCurve(costCurvePoints([]))).toBe('No plan rows bring in cash yet.');
    expect(
      describeCostCurve(costCurvePoints([{ label: 'Harbor & Co', cost: 21, cash: 1729 }])),
    ).toBe('Cheapest cash first. Harbor & Co: $1,729.00 for $21.00. In all, $1,729.00 for $21.00.');
  });
});
