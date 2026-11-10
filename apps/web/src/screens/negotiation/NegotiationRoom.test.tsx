import { endpoints, type ServerEvent } from '@terms/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { createFakeEventSource, FakeEventSource } from '../../test/fakeEventSource';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as NegotiationRoom } from './NegotiationRoom';

installMockApi();

const AT = '2026-11-09T12:00:00Z';

function negotiated() {
  const world = currentWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  world.approve('60.00');
  world.startNegotiation();
}

function renderRoom(path = '/negotiation') {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      {/* As in the app. Outside <main>, a <header> is a page banner. */}
      <main>
        <NegotiationRoom />
      </main>
    </MemoryRouter>,
    { businessId: 'biz_maya', createSource: createFakeEventSource },
  );
}

const emit = (event: ServerEvent) => {
  act(() => {
    FakeEventSource.latest!.emit(event);
  });
};

describe('Negotiation Room', () => {
  it('shows skeletons while loading', async () => {
    server.use(
      http.get(endpoints.listDeals.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderRoom();
    expect(await screen.findByRole('status')).toHaveTextContent('Loading the negotiations');
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    server.use(
      http.get(
        endpoints.listDeals.path,
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'PAYPAL_ERROR',
                message: 'PayPal could not be reached.',
                retryable: true,
                paypal: { debugId: 'dbg-room', name: null, message: 'x', httpStatus: 503 },
              },
            },
            { status: 502 },
          ),
        { once: true },
      ),
    );
    renderRoom();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('dbg-room');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'No negotiations yet' })).toBeInTheDocument();
  });

  it('points to the Workbench when nothing has started', async () => {
    renderRoom();
    expect(await screen.findByRole('heading', { name: 'No negotiations yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the Workbench' })).toHaveAttribute(
      'href',
      '/workbench',
    );
  });

  it('opens on what needs the owner, side by side, and leaves reminders out', async () => {
    negotiated();
    const { container } = renderRoom();
    expect(
      await screen.findByRole('heading', { name: 'Harbor & Co', level: 2 }),
    ).toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: 'Negotiations' });
    const names = within(list)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names[0]).toContain('Harbor & Co');
    expect(names).toHaveLength(2);
    expect(list).not.toHaveTextContent('Oak Street');
    expect(screen.getByText('Maya Studio’s agent', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Harbor & Co’s side')).toBeInTheDocument();
    const log = screen.getByRole('log', { name: 'Conversation with Harbor & Co' });
    expect(within(log).getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('region', { name: /Needs your approval/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens the deal the address names, and ignores one it cannot find', async () => {
    negotiated();
    const { unmount } = renderRoom('/negotiation?deal=deal_juniper');
    expect(
      await screen.findByRole('heading', { name: 'Juniper Labs', level: 2 }),
    ).toBeInTheDocument();
    unmount();
    renderRoom('/negotiation?deal=gone');
    expect(
      await screen.findByRole('heading', { name: 'Harbor & Co', level: 2 }),
    ).toBeInTheDocument();
  });

  it('switches conversation', async () => {
    negotiated();
    renderRoom();
    await screen.findByRole('heading', { name: 'Harbor & Co', level: 2 });
    await userEvent.click(screen.getByRole('button', { name: /Juniper Labs/ }));
    expect(
      await screen.findByRole('heading', { name: 'Juniper Labs', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Juniper Labs/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('waits for PayPal, without showing the owner the client’s own approval', async () => {
    negotiated();
    renderRoom('/negotiation?deal=deal_juniper');
    const notice = await screen.findByText('Waiting for PayPal confirmation');
    expect(notice.closest('[role="status"]')).toHaveTextContent(
      'Juniper Labs pays through PayPal. This updates when the verified webhook arrives.',
    );
    expect(screen.queryByText(/auto-pay|approves the/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed by PayPal/)).not.toBeInTheDocument();
  });

  it('calls a deal paid only when the server says PayPal confirmed it', async () => {
    negotiated();
    renderRoom('/negotiation?deal=deal_juniper');
    await screen.findByText('Waiting for PayPal confirmation');
    const deal = currentWorld().dealDetail('deal_juniper')!;
    const { paypal: _p, messages: _m, history: _h, approvals: _a, ...summary } = deal;
    emit({
      id: 'paid',
      type: 'deal.updated',
      at: AT,
      data: { deal: { ...summary, state: 'PAID' } },
    });
    expect(await screen.findByText('Paid. Confirmed by PayPal.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting for PayPal confirmation')).not.toBeInTheDocument();
  });

  it('shows committed cash in the accent only once it counts', async () => {
    negotiated();
    renderRoom('/negotiation?deal=deal_juniper');
    await screen.findByRole('heading', { name: 'Juniper Labs', level: 2 });
    expect(screen.getByText('Committed').nextElementSibling?.firstElementChild).toHaveClass(
      'text-committed-strong',
    );
  });

  it('adds a message as it arrives, once', async () => {
    negotiated();
    renderRoom();
    const log = await screen.findByRole('log');
    const message = {
      ...currentWorld().dealDetail('deal_harbor')!.messages[1]!,
      id: 'live-message',
      note: 'One more thing.',
    };
    const event: ServerEvent = {
      id: 'live-1',
      type: 'negotiation.message',
      at: AT,
      data: { message },
    };
    emit(event);
    expect(await within(log).findByText('“One more thing.”')).toBeInTheDocument();
    emit({ ...event, id: 'live-2' });
    expect(within(log).getAllByText('“One more thing.”')).toHaveLength(1);
  });

  it('shows the PayPal calls from the audit log, and nothing before there are any', async () => {
    negotiated();
    const { unmount } = renderRoom();
    const section = await screen.findByRole('region', { name: 'Settlement on PayPal' });
    expect(
      await within(section).findByText(/only touched after both sides agree/),
    ).toBeInTheDocument();
    unmount();
    renderRoom('/negotiation?deal=deal_juniper');
    expect(await screen.findByText('PUT /v2/invoicing/invoices/{id}')).toBeInTheDocument();
  });

  it('adds a verified webhook to the PayPal steps as it arrives', async () => {
    negotiated();
    renderRoom('/negotiation?deal=deal_juniper');
    await screen.findByText('PUT /v2/invoicing/invoices/{id}');
    const entry = {
      ...currentWorld().auditFor('deal_juniper')[0]!,
      id: 'hook',
      action: 'WEBHOOK_VERIFIED' as const,
      summary: 'PayPal confirmed the payment.',
      paypalCall: null,
      webhookVerified: true,
    };
    emit({ id: 'hook-1', type: 'audit.appended', at: AT, data: { entry } });
    expect(await screen.findByText('Verified webhook')).toBeInTheDocument();
    expect(screen.getByText('PayPal confirmed the payment.')).toBeInTheDocument();
  });

  it('removes the decision and shows the new moves after the owner approves', async () => {
    negotiated();
    renderRoom();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Needs your approval/ })).not.toBeInTheDocument();
    });
    const log = screen.getByRole('log');
    expect(within(log).getAllByRole('article')).toHaveLength(4);
    expect(screen.getByText('Waiting for PayPal confirmation')).toBeInTheDocument();
  });

  it('stays on the open conversation when another deal updates', async () => {
    negotiated();
    currentWorld().decideApproval('appr_harbor_counter', 'APPROVED', null);
    renderRoom();
    const first = await screen.findByRole('heading', { level: 2 });
    const opened = first.textContent;
    const {
      paypal: _p,
      messages: _m,
      history: _h,
      approvals: _a,
      ...other
    } = currentWorld().dealDetail(opened === 'Harbor & Co' ? 'deal_juniper' : 'deal_harbor')!;
    emit({
      id: 'other',
      type: 'deal.updated',
      at: AT,
      data: { deal: { ...other, updatedAt: '2026-11-09T23:00:00Z' } },
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole('navigation', { name: 'Negotiations' })).getAllByRole('button')[0],
      ).toHaveTextContent(other.client.name);
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(opened);
  });

  it('moves to a deal that starts needing the owner', async () => {
    const world = currentWorld();
    world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
    world.createPlan();
    world.approve('60.00');
    renderRoom('/negotiation');
    const opened = (await screen.findByRole('heading', { level: 2 })).textContent;
    const otherId = opened === 'Harbor & Co' ? 'deal_juniper' : 'deal_harbor';
    const {
      paypal: _p,
      messages: _m,
      history: _h,
      approvals: _a,
      ...other
    } = world.dealDetail(otherId)!;
    emit({
      id: 'needs',
      type: 'deal.updated',
      at: AT,
      data: { deal: { ...other, state: 'NEEDS_OWNER', updatedAt: '2026-11-09T23:00:00Z' } },
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(other.client.name);
    });
  });

  it('does not call a closed deal open', async () => {
    negotiated();
    currentWorld().decideApproval('appr_harbor_counter', 'REJECTED', null);
    renderRoom('/negotiation?deal=deal_harbor');
    await screen.findByRole('heading', { name: 'Harbor & Co', level: 2 });
    expect(screen.getByText('Last terms')).toBeInTheDocument();
    expect(screen.queryByText('On the table')).not.toBeInTheDocument();
    expect(screen.queryByText('If agreed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Open until/)).not.toBeInTheDocument();
  });

  it('explains a plan that only sends reminders', async () => {
    const world = currentWorld();
    world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
    const plan = world.createPlan();
    for (const name of ['Juniper Labs', 'Harbor & Co']) {
      world.updateItem(plan.items.find((i) => i.client.name === name)!.id, { action: 'NONE' });
    }
    world.approve('60.00');
    renderRoom();
    expect(
      await screen.findByRole('heading', { name: 'Nothing to negotiate' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/only sends reminders/)).toBeInTheDocument();
  });

  it('shows why a loaded conversation failed', async () => {
    negotiated();
    server.use(
      http.get(endpoints.getDeal.path, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Could not read the deal.', retryable: true } },
          { status: 500 },
        ),
      ),
    );
    renderRoom();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read the deal.');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    });
  });
});
