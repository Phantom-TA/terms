import { endpoints } from '@terms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { currentDesk } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as VaultCancel } from './VaultCancel';
import { Component as VaultReturn } from './VaultReturn';

installMockApi('biz_juniper');

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/client/vault/return" element={<VaultReturn />} />
        <Route path="/client/vault/cancel" element={<VaultCancel />} />
        <Route path="/payables" element={<h1>Payables Desk</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const returned = () => {
  const { setupTokenId } = currentDesk().setupVault('biz_juniper', 'http://localhost');
  return `/client/vault/return?approval_token_id=${setupTokenId}`;
};

describe('coming back from PayPal', () => {
  it('waits for PayPal to confirm before saying anything was saved', async () => {
    server.use(
      http.post(endpoints.clientVaultConfirm.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const { container } = renderAt(returned());
    expect(await screen.findByText('Waiting for PayPal confirmation')).toBeInTheDocument();
    expect(screen.queryByText('PayPal method saved')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('confirms once, then says so and goes back to the desk', async () => {
    let confirms = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/vault/confirm')) confirms += 1;
    });
    renderAt(returned());
    expect(await screen.findByRole('heading', { name: 'Payables Desk' })).toBeInTheDocument();
    expect(screen.getByText('PayPal method saved')).toBeInTheDocument();
    expect(currentDesk().vault('biz_juniper').status).toBe('ACTIVE');
    expect(confirms).toBe(1);
    server.events.removeAllListeners();
  });

  it('shows why the method was not saved, and tries again', async () => {
    server.use(
      http.post(
        endpoints.clientVaultConfirm.path,
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'PAYPAL_ERROR',
                message: 'PayPal could not be reached.',
                retryable: true,
                paypal: { debugId: 'dbg-confirm', name: null, message: 'x', httpStatus: 503 },
              },
            },
            { status: 502 },
          ),
        { once: true },
      ),
    );
    renderAt(returned());
    const alert = await screen.findByRole('alert');
    expect(
      screen.getByRole('heading', { name: 'The method wasn’t saved', level: 1 }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent('dbg-confirm');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Payables Desk' })).toBeInTheDocument();
  });

  it('does nothing without an approval from PayPal', () => {
    renderAt('/client/vault/return');
    expect(
      screen.getByRole('heading', { name: 'Nothing to finish', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the Payables Desk' })).toHaveAttribute(
      'href',
      '/payables',
    );
    expect(currentDesk().vault('biz_juniper').status).toBe('NONE');
  });

  it('says nothing was saved when the person cancelled on PayPal', async () => {
    const { container } = renderAt('/client/vault/cancel');
    expect(
      screen.getByRole('heading', { name: 'Nothing was saved', level: 1 }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
