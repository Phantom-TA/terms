import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Component as MockPayPal } from './MockPayPal';

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

describe('mock PayPal approval page', () => {
  it('says it is a stand-in, and approving returns to the app', async () => {
    renderAt(
      '/mock-paypal?kind=vault&return=%2Fclient%2Fvault%2Freturn%3Fapproval_token_id%3Dabc&cancel=%2Fclient%2Fvault%2Fcancel',
    );
    expect(screen.getByText(/Mock of PayPal’s approval page/)).toBeInTheDocument();
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
    renderAt(
      '/mock-paypal?kind=payment&return=%2F%2Fevil.example&cancel=https%3A%2F%2Fevil.example',
    );
    expect(screen.getByRole('heading', { name: 'Approve this payment' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });
});
