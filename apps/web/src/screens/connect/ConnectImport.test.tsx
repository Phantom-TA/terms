import { endpoints } from '@terms/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../lib/display';
import { currentDesk } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as ConnectImport } from './ConnectImport';

installMockApi();

const renderConnect = () =>
  renderWithProviders(
    <main>
      <ConnectImport />
    </main>,
  );

const lastImported = () => screen.getByText('Last imported').nextElementSibling;

const PAYPAL_DOWN = {
  error: {
    code: 'PAYPAL_ERROR',
    message: 'PayPal could not be reached.',
    retryable: true,
    paypal: { debugId: 'dbg-sync', name: null, message: 'x', httpStatus: 503 },
  },
};

describe('Connect and import', () => {
  it('shows a skeleton while checking the connection', async () => {
    server.use(
      http.get(endpoints.getConnection.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderConnect();
    expect(await screen.findByText('Loading the connection')).toBeInTheDocument();
  });

  it('shows the PayPal account and what has been imported', async () => {
    const { container } = renderConnect();
    expect(await screen.findByText('maya-studio@business.example.com')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText('MOCKMERCHANT01')).toBeInTheDocument();
    expect(lastImported()).toHaveTextContent(formatDateTime('2026-11-09T09:55:00Z'));
    expect(screen.getByText('From PayPal’s balances')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('imports from PayPal and reports what changed, with the reporting lag', async () => {
    renderConnect();
    await userEvent.click(await screen.findByRole('button', { name: 'Import from PayPal' }));
    expect(
      await screen.findByText(/Invoices: 0 new, 1 updated, 6 unchanged, 7 in PayPal\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/can lag by a few hours/)).toBeInTheDocument();
    expect(screen.getByText('Imported from PayPal')).toBeInTheDocument();
    await waitFor(() => {
      expect(lastImported()).toHaveTextContent(formatDateTime('2026-11-09T10:30:00Z'));
    });
  });

  it('shows a failed import with its debug ID, and retries it', async () => {
    server.use(
      http.post(endpoints.sync.path, () => HttpResponse.json(PAYPAL_DOWN, { status: 502 }), {
        once: true,
      }),
    );
    renderConnect();
    await userEvent.click(await screen.findByRole('button', { name: 'Import from PayPal' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The import didn’t finish');
    expect(alert).toHaveTextContent('dbg-sync');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/7 in PayPal/)).toBeInTheDocument();
  });

  it('offers no import without working PayPal credentials', async () => {
    const connection = currentDesk().connection();
    server.use(
      http.get(endpoints.getConnection.path, () =>
        HttpResponse.json({ ...connection, paypal: { ...connection.paypal, connected: false } }),
      ),
    );
    renderConnect();
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/no working PayPal credentials/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import from PayPal' })).not.toBeInTheDocument();
  });

  it('shows why the connection could not be checked, and retries', async () => {
    server.use(
      http.get(
        endpoints.getConnection.path,
        () => HttpResponse.json(PAYPAL_DOWN, { status: 502 }),
        {
          once: true,
        },
      ),
    );
    renderConnect();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('dbg-sync');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });
});
