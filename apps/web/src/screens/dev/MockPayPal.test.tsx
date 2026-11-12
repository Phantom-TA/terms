import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component as MockPayPal } from './MockPayPal';
import { isMockPayment, MOCK_PAYPAL_CHANNEL } from './mockPayPalChannel';

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/mock-paypal" element={<MockPayPal />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mock PayPal pages', () => {
  it('says it is a stand-in, and approving a saved method returns to the app', async () => {
    renderAt(
      '/mock-paypal?kind=vault&return=%2Fclient%2Fvault%2Freturn%3Fapproval_token_id%3Dabc&cancel=%2Fclient%2Fvault%2Fcancel',
    );
    expect(screen.getByText(/Mock of PayPal’s pages/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/client/vault/return?approval_token_id=abc',
    );
  });

  it('cancels to the cancel page', async () => {
    renderAt('/mock-paypal?kind=vault&return=%2Fa&cancel=%2Fclient%2Fvault%2Fcancel');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/client/vault/cancel');
  });

  it('never sends anyone to another site', async () => {
    renderAt('/mock-paypal?kind=vault&return=%2F%2Fevil.example&cancel=https%3A%2F%2Fevil.example');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('pays an invoice in its own tab and tells the app’s tab, as PayPal’s webhook would', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor(readonly name: string) {}
        postMessage(data: unknown) {
          posted.push({ channel: this.name, data });
        }
        close() {}
      },
    );
    renderAt('/mock-paypal?kind=invoice&deal=deal_juniper&amount=4960.00');
    expect(screen.getByRole('heading', { name: 'PayPal invoice: $4,960.00' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay with PayPal' }));
    expect(posted).toEqual([
      { channel: MOCK_PAYPAL_CHANNEL, data: { type: 'invoice.paid', dealId: 'deal_juniper' } },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('PayPal doesn’t send you back');
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('accepts only well-formed payment messages from other tabs', () => {
    expect(isMockPayment({ type: 'invoice.paid', dealId: 'd' })).toBe(true);
    expect(isMockPayment({ type: 'invoice.paid' })).toBe(false);
    expect(isMockPayment('invoice.paid')).toBe(false);
    expect(isMockPayment(null)).toBe(false);
  });
});
