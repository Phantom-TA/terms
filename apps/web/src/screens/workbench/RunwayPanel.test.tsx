import { endpoints } from '@terms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { currentWorld, MOCK_FAILURE_KEY } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { RunwayPanel } from './RunwayPanel';

// AG Charts draws to a canvas, which jsdom can't; the browser tests cover the drawing itself.
vi.mock('./RunwayChart', () => ({
  RunwayChart: ({ runway }: { runway: { thresholds: { label: string }[] } }) => (
    <div data-testid="runway-chart">chart with {runway.thresholds[0]?.label}</div>
  ),
}));

installMockApi();

describe('RunwayPanel', () => {
  it('shows a loading state, not an empty box', async () => {
    server.use(
      http.get(endpoints.getRunway.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(<RunwayPanel />);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading the runway');
  });

  it('names the payroll date from the server and shows the chart', async () => {
    currentWorld().parseGoal('I need $6,200 by Friday. Max 1.2%.');
    const { container } = renderWithProviders(<RunwayPanel />);
    expect(await screen.findByTestId('runway-chart')).toHaveTextContent('chart with Payroll');
    expect(screen.getByText(/Payroll lands Fri, Nov 13/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    sessionStorage.setItem(MOCK_FAILURE_KEY, '1');
    renderWithProviders(<RunwayPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the runway');
    expect(alert).toHaveTextContent('mock-debug-id');
    expect(screen.queryByTestId('runway-chart')).not.toBeInTheDocument();

    sessionStorage.removeItem(MOCK_FAILURE_KEY);
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('runway-chart')).toBeInTheDocument();
  });

  it('can be collapsed', async () => {
    renderWithProviders(<RunwayPanel />);
    await screen.findByTestId('runway-chart');
    const details = screen.getByText('Cash runway').closest('details')!;
    expect(details).toHaveAttribute('open');
  });
});
