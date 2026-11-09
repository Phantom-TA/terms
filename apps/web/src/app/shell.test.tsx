import { paths } from '@terms/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { MOCK_FAILURE_KEY } from '../mocks/handlers';
import { renderApp } from '../test/renderApp';

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  sessionStorage.clear();
});

const signIn = (id: string) => {
  sessionStorage.setItem('terms.mock.session', id);
};

describe('session gate', () => {
  it('shows a skeleton while the session loads', async () => {
    server.use(
      http.get(paths.session(), async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderApp();
    expect(await screen.findByRole('status')).toHaveTextContent('Loading your session');
  });

  it('asks who you are when there is no session', async () => {
    const { container } = renderApp();
    expect(
      await screen.findByRole('heading', { name: 'Who are you in this demo?' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Maya Studio/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Harbor & Co/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    sessionStorage.setItem(MOCK_FAILURE_KEY, '1');
    renderApp();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('PayPal could not be reached.');
    expect(alert).toHaveTextContent('mock-debug-id');

    sessionStorage.removeItem(MOCK_FAILURE_KEY);
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Who are you in this demo?' }),
    ).toBeInTheDocument();
  });

  it('shows an empty state when no businesses exist', async () => {
    server.use(http.get(paths.businesses(), () => HttpResponse.json({ businesses: [] })));
    renderApp();
    expect(await screen.findByRole('heading', { name: 'No businesses yet' })).toBeInTheDocument();
  });

  it('starts a session when a business is chosen', async () => {
    const { router } = renderApp();
    await userEvent.click(await screen.findByRole('button', { name: /Maya Studio/ }));
    await waitFor(() => {
      expect(sessionStorage.getItem('terms.mock.session')).toBe('biz_maya');
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workbench');
    });
  });

  it('keeps you on the picker and reports a failed sign-in', async () => {
    server.use(
      http.post(paths.session(), () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Session store is down.', retryable: true } },
          { status: 500 },
        ),
      ),
    );
    renderApp();
    await userEvent.click(await screen.findByRole('button', { name: /Maya Studio/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session store is down.');
    expect(screen.getByRole('heading', { name: 'Who are you in this demo?' })).toBeInTheDocument();
  });
});

describe('app shell', () => {
  it('labels sandbox and demo data', async () => {
    signIn('biz_maya');
    renderApp('/nowhere', 'biz_maya');
    const band = await screen.findByRole('note', { name: 'Environment' });
    await waitFor(() => {
      expect(band).toHaveTextContent('PayPal sandbox · Demo data');
    });
    expect(band).toHaveTextContent('No real money moves');
  });

  it('labels the sandbox before a session exists', async () => {
    renderApp();
    const band = await screen.findByRole('note', { name: 'Environment' });
    expect(band).toHaveTextContent('PayPal sandbox');
    expect(band).not.toHaveTextContent('Demo data');
  });

  it('shows who you are acting as and your role', async () => {
    signIn('biz_harbor');
    renderApp('/nowhere', 'biz_harbor');
    const select = await screen.findByLabelText('Acting as');
    expect(select).toHaveDisplayValue('Harbor & Co');
    expect(await screen.findByText('Client')).toBeInTheDocument();
  });

  it('groups the owner and clients in the switcher', async () => {
    signIn('biz_maya');
    renderApp('/nowhere', 'biz_maya');
    const select = await screen.findByLabelText('Acting as');
    expect(within(select).getByRole('group', { name: 'Owner' })).toHaveTextContent('Maya Studio');
    expect(within(select).getByRole('group', { name: 'Clients' })).toHaveTextContent(
      'Juniper Labs',
    );
  });

  it('switches business and leaves nothing from the previous session', async () => {
    signIn('biz_maya');
    const { queryClient } = renderApp('/nowhere', 'biz_maya');
    queryClient.setQueryData(['invoices'], { private: true });
    const select = await screen.findByLabelText('Acting as');
    await waitFor(() => {
      expect(select).toHaveDisplayValue('Maya Studio');
    });
    await userEvent.selectOptions(select, 'biz_juniper');
    await waitFor(() => {
      expect(select).toHaveDisplayValue('Juniper Labs');
    });
    expect(queryClient.getQueryData(['invoices'])).toBeUndefined();
  });

  it('keeps the current business and shows the error when a switch fails', async () => {
    signIn('biz_maya');
    server.use(
      http.post(paths.session(), () =>
        HttpResponse.json(
          {
            error: {
              code: 'NOT_FOUND',
              message: 'That business does not exist.',
              retryable: false,
            },
          },
          { status: 404 },
        ),
      ),
    );
    renderApp('/nowhere', 'biz_maya');
    const select = await screen.findByLabelText('Acting as');
    await waitFor(() => {
      expect(select).toHaveDisplayValue('Maya Studio');
    });
    await userEvent.selectOptions(select, 'biz_juniper');
    expect(await screen.findByRole('alert')).toHaveTextContent('That business does not exist.');
    expect(select).toHaveDisplayValue('Maya Studio');
  });

  it('offers a way home from an unknown page and has no violations', async () => {
    signIn('biz_maya');
    const { container } = renderApp('/nowhere', 'biz_maya');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your home screen' })).toBeInTheDocument();
    await screen.findByLabelText('Acting as');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps a client out of an owner screen opened by its address', async () => {
    signIn('biz_harbor');
    renderApp('/workbench', 'biz_harbor');
    expect(
      await screen.findByRole('heading', { name: 'This screen is for the other side', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You’re acting as Harbor & Co/)).toBeInTheDocument();
  });

  it('links the owner only to screens that exist', async () => {
    signIn('biz_maya');
    renderApp('/nowhere', 'biz_maya');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Workbench']);
  });

  it('shows a client no navigation until client screens exist, so no link goes nowhere', async () => {
    signIn('biz_harbor');
    renderApp('/nowhere', 'biz_harbor');
    await screen.findByLabelText('Acting as');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });
});
