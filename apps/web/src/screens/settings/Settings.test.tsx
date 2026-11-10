import { endpoints } from '@terms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { currentDesk } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as Settings } from './Settings';

installMockApi();

const signIn = (id: string) => {
  sessionStorage.setItem('terms.mock.session', id);
};

function renderSettings() {
  return renderWithProviders(
    <MemoryRouter initialEntries={['/settings']}>
      <main>
        <Settings />
      </main>
    </MemoryRouter>,
  );
}

describe('Settings for the owner', () => {
  it('shows the policy, the PayPal account and the environment', async () => {
    const { container } = renderSettings();
    expect(await screen.findByLabelText('Maximum discount (%)')).toHaveValue('1.2');
    expect(
      await screen.findByText(/Connected as maya-studio@business\.example\.com/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect and import' })).toHaveAttribute(
      'href',
      '/connect',
    );
    expect(screen.getByText(/PayPal sandbox/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save policy' })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('saves only after the server confirms', async () => {
    renderSettings();
    const max = await screen.findByLabelText('Maximum discount (%)');
    await userEvent.clear(max);
    await userEvent.type(max, '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('Policy saved')).toBeInTheDocument();
    expect(await screen.findByLabelText('Maximum discount (%)')).toHaveValue('1.5');
  });

  it('puts problems next to the fields and sends nothing', async () => {
    let puts = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PUT') puts += 1;
    });
    renderSettings();
    const max = await screen.findByLabelText('Maximum discount (%)');
    await userEvent.clear(max);
    await userEvent.type(max, 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(screen.getByText('Enter a percentage like 1.2')).toBeInTheDocument();
    expect(max).toHaveAttribute('aria-invalid', 'true');
    expect(puts).toBe(0);
    server.events.removeAllListeners();
  });

  it('keeps the changes when saving fails, and says why', async () => {
    server.use(
      http.put(endpoints.putSupplierPolicy.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'INTERNAL',
              message: 'The policy could not be stored.',
              retryable: true,
            },
          },
          { status: 500 },
        ),
      ),
    );
    renderSettings();
    const max = await screen.findByLabelText('Maximum discount (%)');
    await userEvent.clear(max);
    await userEvent.type(max, '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The policy could not be stored.');
    expect(max).toHaveValue('1.5');
    expect(screen.queryByText('Policy saved')).not.toBeInTheDocument();
  });

  it('discards unsaved changes', async () => {
    renderSettings();
    const max = await screen.findByLabelText('Maximum discount (%)');
    await userEvent.clear(max);
    await userEvent.type(max, '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(max).toHaveValue('1.2');
  });
});

describe('Settings for a client', () => {
  it('shows the agent’s policy and the saved PayPal method', async () => {
    signIn('biz_harbor');
    const { container } = renderSettings();
    expect(await screen.findByLabelText('Hurdle rate (% a year)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Saved PayPal method' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Maximum discount (%)')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('saves the client’s policy through the server', async () => {
    signIn('biz_harbor');
    renderSettings();
    const hurdle = await screen.findByLabelText('Hurdle rate (% a year)');
    await userEvent.clear(hurdle);
    await userEvent.type(hurdle, '14');
    await userEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    expect(await screen.findByText('Policy saved')).toBeInTheDocument();
    expect(currentDesk().clientPolicy('biz_harbor').hurdleRatePct).toBe('14.00');
  });

  it('shows a policy that failed to load, with a retry', async () => {
    signIn('biz_harbor');
    server.use(
      http.get(
        endpoints.getClientPolicy.path,
        () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'Down.', retryable: true } },
            { status: 500 },
          ),
        { once: true },
      ),
    );
    renderSettings();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load your policy');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Hurdle rate (% a year)')).toBeInTheDocument();
  });
});
