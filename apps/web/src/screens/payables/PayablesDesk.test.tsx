import { type ClientOffer, endpoints } from '@terms/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../../lib/browser';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createFakeEventSource, FakeEventSource } from '../../test/fakeEventSource';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as PayablesDesk } from './PayablesDesk';

// The real grid is exercised in the browser (e2e/payables.spec.ts). Here it lists what it was given.
vi.mock('./OffersGrid', () => ({
  OffersGrid: ({ offers }: { offers: readonly ClientOffer[] }) => (
    <ol data-testid="offers-grid">
      {offers.map((o) => (
        <li key={o.dealId}>
          {o.supplier.name} {o.invoice.number} {o.impliedAnnualRate} {o.recommendation}
        </li>
      ))}
    </ol>
  ),
}));

installMockApi('biz_juniper');

afterEach(() => {
  vi.restoreAllMocks();
});

function negotiated() {
  const world = currentWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  world.approve('60.00');
  world.startNegotiation();
}

function renderDesk() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/payables']}>
      <main>
        <PayablesDesk />
      </main>
    </MemoryRouter>,
    { businessId: 'biz_juniper', createSource: createFakeEventSource },
  );
}

describe('Payables Desk', () => {
  it('shows skeletons while the offers load', async () => {
    server.use(
      http.get(endpoints.listClientOffers.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderDesk();
    expect(await screen.findByText('Loading offers')).toBeInTheDocument();
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    server.use(
      http.get(
        endpoints.listClientOffers.path,
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'PAYPAL_ERROR',
                message: 'PayPal could not be reached.',
                retryable: true,
                paypal: { debugId: 'dbg-desk', name: null, message: 'x', httpStatus: 503 },
              },
            },
            { status: 502 },
          ),
        { once: true },
      ),
    );
    renderDesk();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('dbg-desk');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'No offers right now' })).toBeInTheDocument();
  });

  it('says when no supplier has offered anything', async () => {
    const { container } = renderDesk();
    expect(await screen.findByRole('heading', { name: 'No offers right now' })).toBeInTheDocument();
    expect(screen.queryByTestId('offers-grid')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the cash position and the offers in the server’s order', async () => {
    negotiated();
    const { container } = renderDesk();
    const grid = await screen.findByTestId('offers-grid');
    expect(within(grid).getAllByRole('listitem')[0]).toHaveTextContent('Maya Studio');
    expect(grid).toHaveTextContent('NEEDS_HUMAN');
    expect(screen.getByText('Can pay early').nextSibling).toHaveTextContent('$');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('switches between open and closed offers', async () => {
    negotiated();
    renderDesk();
    await screen.findByTestId('offers-grid');
    await userEvent.click(screen.getByRole('button', { name: 'Closed' }));
    expect(screen.getByRole('button', { name: 'Closed' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('heading', { name: 'No closed offers' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByTestId('offers-grid')).toBeInTheDocument();
  });

  it('sends a person to PayPal to approve a payment over the limit', async () => {
    negotiated();
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderDesk();
    const card = await screen.findByRole('region', {
      name: 'Needs your approval: Approve the $4,960.00 payment to Maya Studio',
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Approve in PayPal' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('/mock-paypal?kind=payment'));
    });
    expect(await screen.findByText('Opening PayPal')).toBeInTheDocument();
  });

  it('starts saving a PayPal method on PayPal, and says it is waiting until PayPal confirms', async () => {
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderDesk();
    const vault = await screen.findByRole('heading', { name: 'Saved PayPal method' });
    const card = vault.closest('section') ?? document.body;
    expect(await within(card).findByText('Not saved')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Save a PayPal method' }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('/mock-paypal?kind=vault'));
    });
  });

  it('shows why saving a method could not start', async () => {
    server.use(
      http.post(endpoints.clientVaultSetup.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'PAYPAL_ERROR',
              message: 'PayPal refused.',
              retryable: true,
              paypal: { debugId: 'dbg-vault', name: null, message: 'x', httpStatus: 500 },
            },
          },
          { status: 502 },
        ),
      ),
    );
    const assign = vi.spyOn(browser, 'assign').mockImplementation(() => undefined);
    renderDesk();
    await userEvent.click(await screen.findByRole('button', { name: 'Save a PayPal method' }));
    expect(await screen.findByText('Couldn’t start saving the method')).toBeInTheDocument();
    expect(screen.getByText(/dbg-vault/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('refreshes the offers when a deal changes', async () => {
    renderDesk();
    expect(await screen.findByRole('heading', { name: 'No offers right now' })).toBeInTheDocument();
    negotiated();
    const {
      paypal: _p,
      messages: _m,
      history: _h,
      approvals: _a,
      ...deal
    } = currentWorld().dealDetail('deal_juniper')!;
    act(() => {
      FakeEventSource.latest!.emit({
        id: 'evt_test',
        type: 'deal.updated',
        at: '2026-11-09T12:00:00Z',
        data: { deal },
      });
    });
    expect(await screen.findByTestId('offers-grid')).toBeInTheDocument();
  });
});
