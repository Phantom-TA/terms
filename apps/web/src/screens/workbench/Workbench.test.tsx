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
import { type WorkbenchGridProps } from './WorkbenchGrid';
import { Component as Workbench } from './Workbench';

// The real grid is exercised in the browser (e2e/workbench.spec.ts). Here it reports what the
// screen hands it, so the screen's own wiring can be tested quickly.
vi.mock('./WorkbenchGrid', () => ({
  WorkbenchGrid: ({ rows, summary, canEdit }: WorkbenchGridProps) => (
    <div data-testid="workbench-grid">
      <p>rows: {rows.length}</p>
      <p>canEdit: {String(canEdit)}</p>
      <p>summary: {summary ? summary.cost : 'none'}</p>
    </div>
  ),
}));

installMockApi();

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

describe('Workbench screen', () => {
  it('shows skeleton rows while loading, not a blank page', async () => {
    server.use(
      http.get(endpoints.currentGoal.path, async () => {
        await delay('infinite');
        return HttpResponse.json({ goal: null, plan: null });
      }),
    );
    renderWithProviders(<Workbench />);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading the Workbench');
    expect(screen.getByRole('heading', { name: 'Workbench', level: 1 })).toBeInTheDocument();
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    sessionStorage.setItem(MOCK_FAILURE_KEY, '1');
    renderWithProviders(<Workbench />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('PayPal could not be reached.');
    expect(alert).toHaveTextContent('mock-debug-id');
    expect(screen.queryByTestId('workbench-grid')).not.toBeInTheDocument();

    sessionStorage.removeItem(MOCK_FAILURE_KEY);
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('workbench-grid')).toBeInTheDocument();
  });

  it('shows the goal box and the invoices before any goal exists', async () => {
    const { container } = renderWithProviders(<Workbench />);
    expect(await screen.findByLabelText(/What cash do you need/)).toBeInTheDocument();
    expect(await screen.findByText('rows: 5')).toBeInTheDocument();
    expect(screen.getByText('canEdit: false')).toBeInTheDocument();
    expect(screen.getByText('summary: none')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the empty state when there are no open invoices', async () => {
    server.use(
      http.get(endpoints.listInvoices.path, () =>
        HttpResponse.json({
          rows: [],
          planId: null,
          today: '2026-11-09',
          lastSyncedAt: null,
          demo: true,
        }),
      ),
    );
    renderWithProviders(<Workbench />);
    expect(await screen.findByRole('heading', { name: 'No open invoices' })).toBeInTheDocument();
    expect(screen.getByText('Create one in PayPal or run the demo seed.')).toBeInTheDocument();
    expect(screen.queryByTestId('workbench-grid')).not.toBeInTheDocument();
  });

  it('lets the owner edit a draft plan and passes the server’s totals to the grid', async () => {
    currentWorld().parseGoal(SENTENCE);
    currentWorld().createPlan();
    renderWithProviders(<Workbench />);
    expect(await screen.findByText('canEdit: true')).toBeInTheDocument();
    expect(screen.getByText('summary: 54.00')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your goal' })).toBeInTheDocument();
  });

  it('locks the grid once the plan is approved', async () => {
    currentWorld().parseGoal(SENTENCE);
    currentWorld().createPlan();
    currentWorld().approve('60.00');
    renderWithProviders(<Workbench />);
    expect(await screen.findByText('canEdit: false')).toBeInTheDocument();
  });

  it('labels demo data', async () => {
    renderWithProviders(<Workbench />);
    expect(await screen.findByText('Demo data')).toBeInTheDocument();
  });
});
