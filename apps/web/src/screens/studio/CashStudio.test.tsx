import { endpoints } from '@terms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as CashStudio } from './CashStudio';

// Studio itself is exercised in the browser (e2e/studio.spec.ts). Here it shows what it was given.
vi.mock('ag-studio', () => ({
  AgStudioAiModule: { moduleName: 'ai' },
  clientToolRunner: (config: unknown) => config,
  createAiHarness: () => ({}),
  studioTheme: { withParams: (params: object) => params },
}));
vi.mock('ag-studio-react', () => ({
  createWidgets: (config: unknown) => config,
  AgStudioProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  AgStudio: ({
    data,
    mode,
    ai,
    widgets,
  }: {
    data: { sources: { id: string; data: unknown[] }[] };
    mode: string;
    ai: unknown;
    widgets: { additionalTypes: { id: string }[] };
  }) => (
    <section
      aria-label="Studio"
      data-mode={mode}
      data-ai={typeof ai}
      data-widgets={widgets.additionalTypes.map((w) => w.id).join(',')}
    >
      {data.sources.map((s) => (
        <p key={s.id}>
          {s.id}: {s.data.length} rows
        </p>
      ))}
    </section>
  ),
}));

installMockApi();

function renderStudio() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/studio']}>
      <main>
        <CashStudio />
      </main>
    </MemoryRouter>,
  );
}

describe('Cash Studio', () => {
  it('shows skeletons while the data loads', async () => {
    server.use(
      http.get(endpoints.listInvoices.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderStudio();
    expect(await screen.findByText('Loading your cash data')).toBeInTheDocument();
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    server.use(
      http.get(
        endpoints.listInvoices.path,
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'PAYPAL_ERROR',
                message: 'PayPal could not be reached.',
                retryable: true,
                paypal: { debugId: 'dbg-studio', name: null, message: 'x', httpStatus: 503 },
              },
            },
            { status: 502 },
          ),
        { once: true },
      ),
    );
    renderStudio();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('dbg-studio');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Studio' })).toBeInTheDocument();
  });

  it('says to import invoices first when there is nothing to ask about', async () => {
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
      http.get(endpoints.getRunway.path, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'Sync first.', retryable: false } },
          { status: 409 },
        ),
      ),
    );
    renderStudio();
    expect(await screen.findByRole('heading', { name: 'No cash data yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Connect & import' })).toHaveAttribute(
      'href',
      '/connect',
    );
  });

  it('gives Studio the invoices and runway, in edit mode, with the strategist', async () => {
    const { container } = renderStudio();
    const studio = await screen.findByRole('region', { name: 'Studio' });
    expect(studio).toHaveAttribute('data-mode', 'edit');
    expect(studio).toHaveAttribute('data-ai', 'function');
    expect(studio).toHaveAttribute('data-widgets', 'cost-cash-curve');
    expect(within(studio).getByText(/^invoices: \d+ rows/)).not.toHaveTextContent('invoices: 0');
    expect(await within(studio).findByText(/^runway: 31 rows/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cash Studio', level: 1 })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
