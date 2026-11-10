import { endpoints } from '@terms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as ApprovalsInbox } from './ApprovalsInbox';

installMockApi();

const signIn = (id: string) => {
  sessionStorage.setItem('terms.mock.session', id);
};

function negotiated() {
  const world = currentWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  world.approve('60.00');
  world.startNegotiation();
}

const renderInbox = () =>
  renderWithProviders(
    <MemoryRouter>
      <main>
        <ApprovalsInbox />
      </main>
    </MemoryRouter>,
  );

describe('Approvals inbox', () => {
  it('shows skeletons while loading', async () => {
    server.use(
      http.get(endpoints.listApprovals.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderInbox();
    expect(await screen.findByText('Loading approvals')).toBeInTheDocument();
  });

  it('says when nothing needs the owner', async () => {
    const { container } = renderInbox();
    expect(await screen.findByRole('heading', { name: 'Nothing needs you' })).toBeInTheDocument();
    expect(screen.getByText('Nothing decided yet.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the owner only what the owner decides, linked to the negotiation', async () => {
    negotiated();
    const { container } = renderInbox();
    const card = await screen.findByRole('region', {
      name: /Needs your approval: Counter to Harbor/,
    });
    expect(within(card).getByRole('link', { name: 'See the negotiation' })).toHaveAttribute(
      'href',
      '/negotiation?deal=deal_harbor',
    );
    expect(screen.queryByText(/payment to Maya Studio/)).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('moves a decision to the history once the server records it', async () => {
    negotiated();
    renderInbox();
    const card = await screen.findByRole('region', {
      name: /Needs your approval: Counter to Harbor/,
    });
    await userEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('heading', { name: 'Nothing needs you' })).toBeInTheDocument();
    const decided = screen.getByRole('heading', { name: 'Decided' }).parentElement!;
    expect(within(decided).getByText('Rejected')).toBeInTheDocument();
  });

  it('shows a client the payments its people approve, linked to its desk', async () => {
    signIn('biz_juniper');
    negotiated();
    renderInbox();
    const card = await screen.findByRole('region', {
      name: 'Needs your approval: Approve the $4,960.00 payment to Maya Studio',
    });
    expect(within(card).getByRole('link', { name: 'See it on the Payables Desk' })).toHaveAttribute(
      'href',
      '/payables',
    );
  });

  it('shows the real error, and recovers on retry', async () => {
    server.use(
      http.get(
        endpoints.listApprovals.path,
        () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'Down.', retryable: true } },
            { status: 500 },
          ),
        { once: true },
      ),
    );
    renderInbox();
    const alert = await screen.findByRole('alert');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Nothing needs you' })).toBeInTheDocument();
  });
});
