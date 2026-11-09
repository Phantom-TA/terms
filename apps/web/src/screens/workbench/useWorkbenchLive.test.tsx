import { type ApprovalView, type ServerEvent } from '@terms/shared';
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { FakeEventSource, createFakeEventSource } from '../../test/fakeEventSource';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useCurrentGoal, useInvoices, useRunway } from './queries';
import { useWorkbenchLive } from './useWorkbenchLive';

installMockApi();

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";
const AT = '2026-11-09T11:00:00Z';

/** Shows what the cache holds, so a test can see exactly what an event changed. */
function Harness() {
  useWorkbenchLive();
  const goal = useCurrentGoal();
  const invoices = useInvoices();
  const runway = useRunway();
  if (!goal.data || !invoices.data || !runway.data) return <p>loading</p>;
  const juniper = invoices.data.rows.find((r) => r.id === 'inv_juniper');
  const friday = runway.data.points.find((p) => p.date === '2026-11-13');
  return (
    <dl>
      <dt>juniper deal</dt>
      <dd>{juniper?.deal?.state}</dd>
      <dt>juniper counts</dt>
      <dd>{String(juniper?.deal?.countsAsCommitted)}</dd>
      <dt>juniper paypal</dt>
      <dd>{juniper?.paypalStatus}</dd>
      <dt>plan status</dt>
      <dd>{goal.data.plan?.status}</dd>
      <dt>plan committed</dt>
      <dd>{goal.data.plan?.summary.committed}</dd>
      <dt>friday committed line</dt>
      <dd>{friday?.afterCommitted}</dd>
    </dl>
  );
}

async function setup() {
  currentWorld().parseGoal(SENTENCE);
  currentWorld().createPlan();
  renderWithProviders(<Harness />, { businessId: 'biz_maya', createSource: createFakeEventSource });
  await screen.findByText('juniper deal');
  const source = FakeEventSource.latest!;
  act(() => {
    source.open();
  });
  return source;
}

const value = (label: string) => screen.getByText(label).nextElementSibling;

function approval(overrides: Partial<ApprovalView>): ApprovalView {
  return {
    id: 'appr_1',
    type: 'COUNTER_OVER_PLAN',
    requestedFrom: 'OWNER',
    decision: 'PENDING',
    title: 'Counter to Harbor & Co at 1.20%',
    summary: 'Approving takes the plan $1.00 over your ceiling.',
    planId: 'plan_1',
    dealId: 'deal_harbor',
    terms: null,
    paymentAmount: null,
    costImpact: null,
    createdAt: AT,
    decidedAt: null,
    expiresAt: null,
    decisionNote: null,
    ...overrides,
  };
}

describe('useWorkbenchLive', () => {
  it('changes nothing until the server says something happened', async () => {
    await setup();
    expect(value('juniper deal')).toHaveTextContent('SUGGESTED');
    expect(value('plan committed')).toHaveTextContent('0.00');
  });

  it('shows a deal turning committed only when the server sends it', async () => {
    const source = await setup();
    const deal = currentWorld()
      .invoiceRows()
      .find((r) => r.id === 'inv_juniper')!.deal!;
    act(() => {
      source.emit({
        id: 'e1',
        type: 'deal.updated',
        at: AT,
        data: { deal: { ...deal, state: 'AGREED', countsAsCommitted: true } },
      });
    });
    await waitFor(() => {
      expect(value('juniper deal')).toHaveTextContent('AGREED');
    });
    expect(value('juniper counts')).toHaveTextContent('true');
  });

  it('shows PayPal’s confirmation of payment from the invoice event', async () => {
    const source = await setup();
    const invoice = currentWorld()
      .invoiceRows()
      .find((r) => r.id === 'inv_juniper')!;
    act(() => {
      source.emit({
        id: 'e2',
        type: 'invoice.updated',
        at: AT,
        data: {
          invoice: { ...invoice, paypalStatus: 'PAID', amountPaid: '4960.00', amountDue: '0.00' },
        },
      });
    });
    await waitFor(() => {
      expect(value('juniper paypal')).toHaveTextContent('PAID');
    });
  });

  it('takes the plan’s status and totals from the server', async () => {
    const source = await setup();
    const plan = currentWorld().plan!;
    act(() => {
      source.emit({
        id: 'e3',
        type: 'plan.updated',
        at: AT,
        data: {
          planId: plan.id,
          status: 'APPROVED',
          summary: { ...plan.summary, committed: '4960.00' },
        },
      });
    });
    await waitFor(() => {
      expect(value('plan status')).toHaveTextContent('APPROVED');
    });
    expect(value('plan committed')).toHaveTextContent('4960.00');
  });

  it('moves the runway when the server sends a new one', async () => {
    const source = await setup();
    const runway = currentWorld().runway();
    const points = runway.points.map((p) =>
      p.date === '2026-11-13' ? { ...p, afterCommitted: '-1240.00' } : p,
    );
    act(() => {
      source.emit({
        id: 'e4',
        type: 'runway.updated',
        at: AT,
        data: { runway: { ...runway, points } },
      });
    });
    await waitFor(() => {
      expect(value('friday committed line')).toHaveTextContent('-1240.00');
    });
  });

  it('announces the goal being met with the server’s figures', async () => {
    const source = await setup();
    act(() => {
      source.emit({
        id: 'e5',
        type: 'goal.met',
        at: AT,
        data: {
          goalId: 'goal_1',
          planId: 'plan_1',
          target: '6510.00',
          committed: '6689.00',
          cost: '61.00',
          withdrawnDealIds: [],
        },
      });
    });
    const toast = await screen.findByText('Goal met');
    expect(toast.closest('[role="status"]')).toHaveTextContent(
      '$6,689.00 is committed against a $6,510.00 target, for $61.00',
    );
  });

  it('tells the owner when something needs their approval', async () => {
    const source = await setup();
    act(() => {
      source.emit({
        id: 'e6',
        type: 'approval.requested',
        at: AT,
        data: { approval: approval({}) },
      });
    });
    const toast = await screen.findByText('Needs your approval');
    expect(toast.closest('[role="status"]')).toHaveTextContent('Counter to Harbor & Co at 1.20%');
  });

  it('does not tell the owner about approvals that belong to someone else', async () => {
    const source = await setup();
    act(() => {
      source.emit({
        id: 'e7',
        type: 'approval.requested',
        at: AT,
        data: { approval: approval({ requestedFrom: 'CLIENT_HUMAN', type: 'CLIENT_PAYMENT' }) },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Needs your approval')).not.toBeInTheDocument();
  });

  it('ignores an event that is not valid, rather than showing it', async () => {
    const source = await setup();
    const bad = { id: 'e8', type: 'deal.updated', at: AT, data: {} } as unknown as ServerEvent;
    const original = console.error;
    console.error = () => {};
    act(() => {
      source.emit(bad);
    });
    console.error = original;
    expect(value('juniper deal')).toHaveTextContent('SUGGESTED');
  });
});
