import { type ApprovalView, endpoints, type NegotiationMessage } from '@terms/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { ApprovalCard } from './ApprovalCard';
import { MessageCard, partyLabel } from './MessageCard';
import { settlementSteps } from './SettlementSteps';

installMockApi();

let approval: ApprovalView;
let counter: NegotiationMessage;

beforeEach(() => {
  const world = currentWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  world.approve('60.00');
  world.startNegotiation();
  approval = world.listApprovals().find((a) => a.id === 'appr_harbor_counter')!;
  counter = world.dealDetail('deal_harbor')!.messages[1]!;
});

describe('partyLabel', () => {
  const label = (actor: NegotiationMessage['actor'], from: string) =>
    partyLabel({ actor, from }, 'Harbor & Co', 'Maya Studio');

  it('names who made each move', () => {
    expect(label('SUPPLIER_AGENT', 'supplier:maya-studio')).toBe('Maya Studio’s agent');
    expect(label('CLIENT_AGENT', 'client:harbor-co')).toBe('Harbor & Co’s agent');
    expect(label('CLIENT_HUMAN', 'client:harbor-co')).toBe('Harbor & Co (a person)');
    expect(label('OWNER', 'supplier:maya-studio')).toBe('You');
  });
});

describe('MessageCard', () => {
  const card = (message: NegotiationMessage, latest = false) =>
    render(
      <MessageCard
        message={message}
        clientName="Harbor & Co"
        supplierName="Maya Studio"
        latest={latest}
      />,
    );

  it('shows the move, its terms and the annualised return', async () => {
    const { container } = card(counter);
    const article = screen.getByRole('article', {
      name: 'Harbor & Co’s agent: Counter, round 1',
    });
    expect(article).toHaveTextContent('Paid early$1,750.00');
    expect(article).toHaveTextContent('Discount1.5%');
    expect(article).toHaveTextContent('Pays now$1,723.75');
    expect(article).toHaveTextContent('23.2% a year');
    expect(article).toHaveTextContent('Round 1 of 3');
    expect(article).toHaveTextContent('Rest due');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the policy checks inline, including a blocked one', () => {
    card(counter);
    expect(screen.getByRole('article')).toHaveTextContent('Hurdle rate');
    expect(screen.getAllByText('· blocked')).not.toHaveLength(0);
  });

  it('colours the two parties differently', () => {
    const { rerender } = card(counter);
    expect(screen.getByRole('article')).toHaveClass('border-t-client');
    const offer = currentWorld().dealDetail('deal_harbor')!.messages[0]!;
    rerender(<MessageCard message={offer} clientName="Harbor & Co" supplierName="Maya Studio" />);
    expect(screen.getByRole('article')).toHaveClass('border-t-supplier');
  });

  it('shows no terms for a message without any', () => {
    card({ ...counter, type: 'DECLINE', terms: null, impliedAnnualRate: null, payNow: null });
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.queryByText('Paid early')).not.toBeInTheDocument();
  });

  it('only says the latest message is open', () => {
    const { unmount } = card(counter);
    expect(screen.queryByText(/Open until/)).not.toBeInTheDocument();
    unmount();
    card(counter, true);
    expect(screen.getByText(/Open until/)).toBeInTheDocument();
  });
});

describe('ApprovalCard', () => {
  it('says what approving costs against the ceiling', async () => {
    const { container } = renderWithProviders(<ApprovalCard approval={approval} />);
    const card = screen.getByRole('region', { name: /Needs your approval/ });
    expect(card).toHaveTextContent('Plan cost$54.00 → $61.00');
    expect(card).toHaveTextContent('Your ceiling$60.00');
    expect(card).toHaveTextContent('Over your ceiling by+$1.00');
    expect(card).toHaveTextContent('Would offer$1,750.00 at 1.2%');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('approves, and says so only after the server confirms', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(endpoints.decideApproval.path, async () => {
        await gate;
        return HttpResponse.json({
          approval: currentWorld().decideApproval(approval.id, 'APPROVED', null).approval,
          paypalApprovalUrl: null,
        });
      }),
    );
    renderWithProviders(<ApprovalCard approval={approval} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    release();
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(currentWorld().plan?.summary.committed).toBe('6689.00');
  });

  it('rejects', async () => {
    renderWithProviders(<ApprovalCard approval={approval} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    await waitFor(() => {
      expect(currentWorld().dealDetail('deal_harbor')?.state).toBe('DECLINED');
    });
  });

  it('keeps the decision open and shows the debug ID when the server fails', async () => {
    server.use(
      http.post(endpoints.decideApproval.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'PAYPAL_ERROR',
              message: 'PayPal could not be reached.',
              retryable: true,
              paypal: { debugId: 'dbg-decide', name: null, message: 'x', httpStatus: 503 },
            },
          },
          { status: 502 },
        ),
      ),
    );
    renderWithProviders(<ApprovalCard approval={approval} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Your decision was not recorded');
    expect(alert).toHaveTextContent('dbg-decide');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.queryByText('Approved')).not.toBeInTheDocument();
    expect(currentWorld().dealDetail('deal_harbor')?.state).toBe('NEEDS_OWNER');
  });
});

describe('settlementSteps', () => {
  it('keeps only PayPal’s entries, oldest first', () => {
    const base = currentWorld().auditFor('deal_juniper')[0]!;
    const steps = settlementSteps([
      { ...base, id: 'newest', paypalCall: null, webhookVerified: true },
      { ...base, id: 'internal', paypalCall: null, webhookVerified: null },
      { ...base, id: 'oldest', paypalCall: 'PUT /x', webhookVerified: null },
    ]);
    expect(steps.map((s) => s.id)).toEqual(['oldest', 'newest']);
  });
});
