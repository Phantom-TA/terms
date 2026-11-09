import { type BusinessRef } from '@terms/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { endpoints } from '@terms/shared';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { GoalBar } from './GoalBar';
import { useCurrentGoal } from './queries';

installMockApi();

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";
const CLIENTS: BusinessRef[] = [
  { id: 'biz_juniper', name: 'Juniper Labs', slug: 'juniper-labs', hasAgent: true },
  { id: 'biz_harbor', name: 'Harbor & Co', slug: 'harbor-co', hasAgent: true },
  { id: 'biz_pinecrest', name: 'Pinecrest Dental', slug: 'pinecrest-dental', hasAgent: false },
];

function Harness() {
  const goal = useCurrentGoal();
  if (!goal.data) return <p>loading</p>;
  return <GoalBar goal={goal.data.goal} hasPlan={goal.data.plan !== null} clients={CLIENTS} />;
}

async function readGoal(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/What cash do you need/), SENTENCE);
  await user.click(screen.getByRole('button', { name: 'Read my goal' }));
  return screen.findByRole('region', { name: 'Your goal' });
}

describe('GoalBar', () => {
  it('starts with a sentence box and no way to submit nothing', async () => {
    renderWithProviders(<Harness />);
    expect(await screen.findByLabelText(/What cash do you need/)).toHaveAttribute(
      'placeholder',
      expect.stringContaining('$6,200'),
    );
    expect(screen.getByRole('button', { name: 'Read my goal' })).toBeDisabled();
  });

  it('turns the sentence into chips the owner can check', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    const understood = within(goal).getByRole('group', { name: 'What I understood' });
    expect(understood).toHaveTextContent('Amount$6,200');
    expect(understood).toHaveTextContent('ByFri, Nov 13');
    expect(understood).toHaveTextContent('Max discount1.2%');
    expect(understood).toHaveTextContent('Opening0.8%');
    expect(understood).toHaveTextContent('Buffer5%');
    expect(understood).toHaveTextContent('Target$6,510');
    expect(within(goal).getByRole('group', { name: 'Do not contact' })).toHaveTextContent(
      'Pinecrest DentalBirch Legal',
    );
    expect(within(goal).getByText(/Payroll of \$11,400 lands Friday/)).toBeInTheDocument();
    expect(within(goal).getByText('Confirmed from PayPal history')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a loading state while the goal is being read', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(endpoints.createGoal.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderWithProviders(<Harness />);
    await user.type(await screen.findByLabelText(/What cash do you need/), SENTENCE);
    await user.click(screen.getByRole('button', { name: 'Read my goal' }));
    expect(screen.getByRole('button', { name: 'Read my goal' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByLabelText(/What cash do you need/)).toBeDisabled();
  });

  it('shows the real failure and offers a retry, with no goal created', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(endpoints.createGoal.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'AI_ERROR',
              message: 'The goal parser is unavailable.',
              retryable: true,
            },
          },
          { status: 502 },
        ),
      ),
    );
    renderWithProviders(<Harness />);
    await user.type(await screen.findByLabelText(/What cash do you need/), SENTENCE);
    await user.click(screen.getByRole('button', { name: 'Read my goal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The goal parser is unavailable.');
    expect(screen.queryByRole('region', { name: 'Your goal' })).not.toBeInTheDocument();
    expect(currentWorld().goal).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('edits the amount in a chip and shows the forecast question that follows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    await user.click(within(goal).getByRole('button', { name: /Edit Amount/ }));
    const input = screen.getByLabelText('Amount');
    await user.clear(input);
    await user.type(input, '7000{Enter}');
    await waitFor(() => {
      expect(within(goal).getByRole('group', { name: 'What I understood' })).toHaveTextContent(
        'Amount$7,000',
      );
    });
    expect(currentWorld().goal?.amount).toBe('7000.00');
    expect(await within(goal).findByText('Doesn’t match PayPal history')).toBeInTheDocument();
    expect(within(goal).getByText(/implies a gap of/)).toBeInTheDocument();
  });

  it('refuses a bad value without calling the server', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    await user.click(within(goal).getByRole('button', { name: /Edit Max discount/ }));
    await user.type(screen.getByLabelText('Max discount'), '{Control>}a{/Control}banana{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a percentage like 1.2');
    expect(currentWorld().goal?.maxDiscountPct).toBe('1.20');
  });

  it('keeps the opening discount at or below the maximum', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    await user.click(within(goal).getByRole('button', { name: /Edit Opening/ }));
    await user.type(screen.getByLabelText('Opening'), '{Control>}a{/Control}2{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("can't be above your 1.20% maximum");
  });

  it('removes a client from the do-not-contact list only after the server agrees', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    await user.click(
      within(goal).getByRole('button', { name: 'Allow contact with Pinecrest Dental' }),
    );
    await waitFor(() => {
      expect(
        within(goal).queryByRole('button', { name: 'Allow contact with Pinecrest Dental' }),
      ).toBeNull();
    });
    expect(
      within(goal).getByRole('button', { name: 'Allow contact with Birch Legal' }),
    ).toBeInTheDocument();
    expect(currentWorld().goal?.doNotContact.map((d) => d.matchedName)).toEqual(['Birch Legal']);
  });

  it('keeps a client protected and says so when the server refuses the change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    server.use(
      http.patch(endpoints.updateGoal.path, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'Could not save.', retryable: true } },
          { status: 500 },
        ),
      ),
    );
    await user.click(
      within(goal).getByRole('button', { name: 'Allow contact with Pinecrest Dental' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save.');
    expect(
      within(goal).getByRole('button', { name: 'Allow contact with Pinecrest Dental' }),
    ).toBeInTheDocument();
    expect(currentWorld().goal?.doNotContact).toHaveLength(2);
  });

  it('keeps warning about a name it could not match, even after the list is saved', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(endpoints.createGoal.path, () => {
        const goal = currentWorld().parseGoal(SENTENCE);
        goal.doNotContact.push({ name: 'Zenith', businessId: null, matchedName: null });
        return HttpResponse.json({ goal }, { status: 201 });
      }),
    );
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    const list = within(goal).getByRole('group', { name: 'Do not contact' });
    expect(list).toHaveTextContent('No client matched “Zenith”. Not protected');

    // Saving the list by client ID drops the unmatched name on the server.
    await user.selectOptions(within(goal).getByLabelText('Add a client to protect'), 'biz_harbor');
    await within(goal).findByRole('button', { name: 'Allow contact with Harbor & Co' });
    expect(currentWorld().goal?.doNotContact.some((d) => d.name === 'Zenith')).toBe(false);
    expect(list).toHaveTextContent('No client matched “Zenith”. Not protected');
  });

  it('does not let a second change race the first', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(endpoints.updateGoal.path, async () => {
        await gate;
        return HttpResponse.json({ goal: currentWorld().goal });
      }),
    );
    await user.selectOptions(within(goal).getByLabelText('Add a client to protect'), 'biz_harbor');
    expect(within(goal).getByLabelText('Add a client to protect')).toBeDisabled();
    expect(
      within(goal).getByRole('button', { name: 'Allow contact with Pinecrest Dental' }),
    ).toBeDisabled();
    release();
    await waitFor(() => {
      expect(within(goal).getByLabelText('Add a client to protect')).toBeEnabled();
    });
  });

  it('offers only clients who are not already protected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    const select = within(goal).getByLabelText('Add a client to protect');
    expect(within(select).queryByRole('option', { name: 'Pinecrest Dental' })).toBeNull();
    await user.selectOptions(select, 'biz_harbor');
    await waitFor(() => {
      expect(within(goal).getByRole('group', { name: 'Do not contact' })).toHaveTextContent(
        'Harbor & Co',
      );
    });
  });

  it('builds the plan on confirm, then locks the goal with no dead buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    await user.click(within(goal).getByRole('button', { name: 'Confirm and build plan' }));
    await waitFor(() => {
      expect(within(goal).queryByRole('button', { name: 'Confirm and build plan' })).toBeNull();
    });
    expect(currentWorld().plan).not.toBeNull();
    expect(within(goal).queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(within(goal).queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(within(goal).getByRole('group', { name: 'What I understood' })).toHaveTextContent(
      'Amount$6,200',
    );
  });

  it('reports a planner failure and leaves the goal as a draft', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    server.use(
      http.post(endpoints.createPlan.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'PAYPAL_ERROR',
              message: 'PayPal could not be read.',
              retryable: true,
              paypal: { debugId: 'dbg-77', name: null, message: 'x', httpStatus: 503 },
            },
          },
          { status: 502 },
        ),
      ),
    );
    await user.click(within(goal).getByRole('button', { name: 'Confirm and build plan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dbg-77');
    expect(within(goal).getByRole('button', { name: 'Confirm and build plan' })).toBeEnabled();
  });

  it('lets the owner start over before planning', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const goal = await readGoal(user);
    await user.click(within(goal).getByRole('button', { name: 'Start over' }));
    expect(await screen.findByLabelText(/What cash do you need/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep the current goal' }));
    expect(await screen.findByRole('region', { name: 'Your goal' })).toBeInTheDocument();
  });
});
