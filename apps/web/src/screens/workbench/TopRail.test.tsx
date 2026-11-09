import { endpoints } from '@terms/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useCurrentGoal } from './queries';
import { TopRail } from './TopRail';

installMockApi();

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

function Harness() {
  const query = useCurrentGoal();
  const { goal, plan } = query.data ?? { goal: null, plan: null };
  return goal && plan ? <TopRail goal={goal} plan={plan} /> : <p>loading</p>;
}

function draftPlan() {
  currentWorld().parseGoal(SENTENCE);
  currentWorld().createPlan();
  return renderWithProviders(<Harness />);
}

const rail = () => screen.findByRole('region', { name: 'Plan summary' });

describe('TopRail', () => {
  it('shows the server’s figures: gap, committed, planned, cost, ceiling and best effort', async () => {
    const { container } = draftPlan();
    const region = await rail();
    expect(region).toHaveTextContent('Gap to close$6,200.00');
    expect(region).toHaveTextContent('Target $6,510.00 with $310.00 buffer');
    expect(region).toHaveTextContent('Committed$0.00');
    expect(region).toHaveTextContent('$6,510.00 still to commit');
    expect(region).toHaveTextContent('Planned, not committed$6,696.00');
    expect(region).toHaveTextContent('Cost so far$0.00');
    expect(region).toHaveTextContent('$54.00 planned · ceiling $60.00');
    expect(region).toHaveTextContent('Best effort$1,800.00');
    expect(region).toHaveTextContent('Reminders. Not counted');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('draws only committed cash in the accent', async () => {
    draftPlan();
    await rail();
    /** The value that sits under a label in the summary. */
    const valueOf = (label: string) => {
      const value = screen.getByText(label, { selector: 'dt' }).nextElementSibling;
      if (!value) throw new Error(`No value under ${label}`);
      return value;
    };
    expect(valueOf('Committed')).toHaveClass('text-committed-strong');
    for (const label of ['Gap to close', 'Planned, not committed', 'Cost so far', 'Best effort']) {
      expect(valueOf(label), label).not.toHaveClass('text-committed-strong');
    }
  });

  it('says nothing is sent until the owner approves', async () => {
    draftPlan();
    expect(await screen.findByText('Nothing is sent until you approve.')).toBeInTheDocument();
  });

  it('warns when the plan cannot reach the target within the limits', async () => {
    currentWorld().parseGoal(SENTENCE);
    const plan = currentWorld().createPlan();
    server.use(
      http.get(endpoints.currentGoal.path, () =>
        HttpResponse.json({
          goal: currentWorld().goal,
          plan: {
            ...plan,
            summary: { ...plan.summary, shortfall: true, plannedCommitted: '4960.00' },
          },
        }),
      ),
    );
    renderWithProviders(<Harness />);
    expect(await screen.findByRole('note')).toHaveTextContent('can’t reach $6,510.00');
    expect(screen.getByRole('note')).toHaveTextContent('would commit $4,960.00');
  });

  it('says the goal is met when the server says so, and offers no approval', async () => {
    currentWorld().parseGoal(SENTENCE);
    const plan = currentWorld().createPlan();
    server.use(
      http.get(endpoints.currentGoal.path, () =>
        HttpResponse.json({
          goal: currentWorld().goal,
          plan: {
            ...plan,
            status: 'MET',
            summary: {
              ...plan.summary,
              committed: '6689.00',
              goalMet: true,
              remaining: '0.00',
              costSoFar: '61.00',
            },
          },
        }),
      ),
    );
    renderWithProviders(<Harness />);
    expect(await screen.findByRole('note')).toHaveTextContent('Goal met for $6,200.00');
    expect(await rail()).toHaveTextContent('Committed$6,689.00');
    expect(screen.queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument();
  });
});

describe('approving the plan', () => {
  it('explains what will be sent before asking', async () => {
    draftPlan();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve this plan?' });
    expect(dialog).toHaveTextContent('Send 2 offers worth $6,696.00');
    expect(dialog).toHaveTextContent('Send 1 reminder, free and best effort, never counted');
    expect(dialog).toHaveTextContent('Total discount cost if every offer is accepted: $54.00');
    expect(dialog).toHaveTextContent('Protected clients are never contacted');
    expect(screen.getByLabelText('Cost ceiling')).toHaveValue('60.00');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('changes nothing if the owner cancels', async () => {
    draftPlan();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(currentWorld().plan?.status).toBe('DRAFT');
  });

  it('sends the ceiling the owner chose and reports approval only once the server confirms', async () => {
    draftPlan();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(endpoints.approvePlan.path, async ({ request }) => {
        await gate;
        const body = (await request.json()) as { costCeiling: string };
        return HttpResponse.json({ plan: currentWorld().approve(body.costCeiling) });
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    const ceiling = await screen.findByLabelText('Cost ceiling');
    await userEvent.clear(ceiling);
    await userEvent.type(ceiling, '75');
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve plan' }));

    // While the server works, nothing says it is approved.
    expect(within(dialog).getByRole('button', { name: 'Approve plan' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('Plan approved')).not.toBeInTheDocument();
    expect(currentWorld().plan?.status).toBe('DRAFT');

    release();
    expect(await screen.findByText('Plan approved', { selector: 'p' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(currentWorld().plan).toMatchObject({ status: 'APPROVED', costCeiling: '75.00' });
    const region = await rail();
    expect(within(region).getByText('Plan approved', { selector: 'span' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Approve plan' })).not.toBeInTheDocument();
  });

  it('refuses a ceiling that is not an amount', async () => {
    draftPlan();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    const ceiling = await screen.findByLabelText('Cost ceiling');
    await userEvent.clear(ceiling);
    await userEvent.type(ceiling, 'plenty');
    expect(screen.getByText('Enter an amount like 60')).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve plan' }),
    ).toBeDisabled();
  });

  it('warns, but does not block, when the plan costs more than the ceiling', async () => {
    draftPlan();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    const ceiling = await screen.findByLabelText('Cost ceiling');
    await userEvent.clear(ceiling);
    await userEvent.type(ceiling, '50');
    expect(
      screen.getByText(/costs \$54\.00 if every offer is accepted, which is above this ceiling/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve plan' }),
    ).toBeEnabled();
  });

  it('keeps the dialog open and shows the PayPal debug ID when the server fails', async () => {
    draftPlan();
    server.use(
      http.post(endpoints.approvePlan.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'PAYPAL_ERROR',
              message: 'PayPal could not be reached.',
              retryable: true,
              paypal: { debugId: 'dbg-approve', name: null, message: 'x', httpStatus: 503 },
            },
          },
          { status: 502 },
        ),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve plan' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The plan was not approved');
    expect(alert).toHaveTextContent('dbg-approve');
    expect(alert).toHaveTextContent('Nothing was marked as done');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(currentWorld().plan?.status).toBe('DRAFT');
    expect(screen.queryByText('Plan approved')).not.toBeInTheDocument();
  });

  it('shows the dialog pending state with a slow server', async () => {
    draftPlan();
    server.use(
      http.post(endpoints.approvePlan.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Approve plan' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve plan' }));
    expect(within(dialog).getByRole('button', { name: 'Approve plan' })).toBeDisabled();
  });
});
