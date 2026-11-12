import { act, render, screen } from '@testing-library/react';
import { type AgWidgetParams } from 'ag-studio';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { type CostCurve, CostCurveWidget } from './CostCurveWidget';

// The chart itself is drawn in the browser (e2e/studio.spec.ts). Here it shows its data.
vi.mock('ag-charts-react', () => ({
  AgCharts: ({ options }: { options: { data: { label: string }[] } }) => (
    <ol data-testid="chart">
      {options.data.map((d) => (
        <li key={d.label}>{d.label}</li>
      ))}
    </ol>
  ),
}));

const field = (key: string) => ({ key, fieldId: key }) as never;

function widget(
  rows: Record<string, unknown>[],
  mapping: Partial<Record<'label' | 'cost' | 'cash', string>> = {
    label: 'client',
    cost: 'cost',
    cash: 'cash',
  },
  response: { replaced?: boolean } = {},
) {
  const widgetApi = {
    setDisplayState: vi.fn(),
    getData: vi.fn(() => Promise.resolve({ results: { rows }, ...response })),
  };
  const dataMapping = Object.fromEntries(
    Object.entries(mapping).map(([slot, key]) => [slot, [field(key)]]),
  );
  const params = {
    dataMapping,
    format: { title: { text: 'What early cash costs' } },
    widgetApi,
  } as unknown as AgWidgetParams<CostCurve>;
  return { params, widgetApi };
}

describe('the cost-versus-cash widget', () => {
  it('asks Studio for its three fields and draws them cheapest first, with its title', async () => {
    const { params, widgetApi } = widget([
      { client: 'Juniper Labs', cost: 40, cash: 4960 },
      { client: 'Harbor & Co', cost: 21, cash: 1729 },
    ]);
    const { container } = render(<CostCurveWidget {...params} />);
    const group = await screen.findByRole('group', { name: 'Cost versus cash chart' });
    expect(screen.getByText('What early cash costs')).toBeInTheDocument();
    expect(widgetApi.getData).toHaveBeenCalledWith(
      { kind: 'flat', fields: [field('client'), field('cost'), field('cash')] },
      expect.objectContaining({ queryId: 'curve' }),
    );
    expect(widgetApi.setDisplayState).toHaveBeenLastCalledWith('displayed');
    expect(screen.getByTestId('chart')).toHaveTextContent('StartJuniper LabsHarbor & Co');
    expect(group).toHaveAccessibleDescription(/Cheapest cash first/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says a field is missing instead of asking for data', () => {
    const { params, widgetApi } = widget([], { label: 'client', cost: 'cost' });
    render(<CostCurveWidget {...params} />);
    expect(widgetApi.setDisplayState).toHaveBeenCalledWith('incompleteDataMapping');
    expect(widgetApi.getData).not.toHaveBeenCalled();
  });

  it('says when there is no data', async () => {
    const { params, widgetApi } = widget([]);
    render(<CostCurveWidget {...params} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(widgetApi.setDisplayState).toHaveBeenLastCalledWith('noData');
  });

  it('ignores an answer a newer query replaced', async () => {
    const { params, widgetApi } = widget([{ client: 'Old', cost: 1, cash: 1 }], undefined, {
      replaced: true,
    });
    render(<CostCurveWidget {...params} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
    expect(widgetApi.setDisplayState).toHaveBeenLastCalledWith('loading');
  });
});
