import { endpoints } from '@terms/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Button } from '../../ui/Button';
import { useCurrentGoal, useInvoices } from './queries';
import { toWorkbenchRows } from './rows';
import { useRowEditing } from './useRowEditing';
import { type EditField } from './validateEdit';

installMockApi();

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

function Harness({ client, field, raw }: { client: string; field: EditField; raw: string }) {
  const goalQuery = useCurrentGoal();
  const invoices = useInvoices();
  const goal = goalQuery.data?.goal ?? null;
  const plan = goalQuery.data?.plan ?? null;
  const { onEdit, saving } = useRowEditing(goal, plan, invoices.data?.today ?? '');
  if (!invoices.data || !plan) return <p>loading</p>;
  const row = toWorkbenchRows(invoices.data.rows, plan.status).find(
    (r) => r.clientName === client,
  )!;
  return (
    <div>
      <Button
        onClick={() => {
          onEdit(row, field, raw);
        }}
      >
        Apply
      </Button>
      <p>saving: {[...saving].join(',') || 'none'}</p>
      <p>planned cost: {plan.summary.plannedCost}</p>
    </div>
  );
}

function setup(client: string, field: EditField, raw: string) {
  const world = currentWorld();
  world.parseGoal(SENTENCE);
  world.createPlan();
  renderWithProviders(<Harness client={client} field={field} raw={raw} />);
}

const apply = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Apply' }));
};

describe('useRowEditing', () => {
  it('blocks a discount above the maximum before it is sent, and says why', async () => {
    setup('Harbor & Co', 'discountPct', '1.5');
    await apply();
    expect(await screen.findByRole('alert')).toHaveTextContent('1.50% is above the 1.20% maximum');
    expect(screen.getByRole('alert')).toHaveTextContent('Harbor & Co: not changed');
    expect(
      currentWorld().plan?.items.find((i) => i.client.name === 'Harbor & Co')?.discountPct,
    ).toBe('0.80');
  });

  it('refuses to message a protected client', async () => {
    setup('Pinecrest Dental', 'action', 'REMINDER');
    await apply();
    expect(await screen.findByRole('alert')).toHaveTextContent('do-not-contact');
    expect(
      currentWorld().plan?.items.find((i) => i.client.name === 'Pinecrest Dental')?.action,
    ).toBe('NONE');
  });

  it('reports success only after the server confirms, with the approval it will need', async () => {
    setup('Harbor & Co', 'discountPct', '1.2');
    await apply();
    const status = await screen.findByText('Harbor & Co updated');
    expect(status.closest('[role="status"]')).toHaveTextContent('$1.00 over the $60.00 ceiling');
    await waitFor(() => {
      expect(screen.getByText('planned cost: 61.00')).toBeInTheDocument();
    });
    expect(currentWorld().plan?.summary.plannedCost).toBe('61.00');
  });

  it('dims the row while the change is in flight, then clears it', async () => {
    setup('Harbor & Co', 'discountPct', '1.0');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.patch(endpoints.updatePlanItem.path, async () => {
        await gate;
        return HttpResponse.json(
          currentWorld().updateItem('item_inv_harbor', { discountPct: '1.00' }),
        );
      }),
    );
    await apply();
    expect(await screen.findByText('saving: inv_harbor')).toBeInTheDocument();
    expect(screen.queryByText('Harbor & Co updated')).not.toBeInTheDocument();
    release();
    expect(await screen.findByText('Harbor & Co updated')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('saving: none')).toBeInTheDocument();
    });
  });

  it('shows which rule the server blocked when the server says no', async () => {
    setup('Harbor & Co', 'discountPct', '1.0');
    server.use(
      http.patch(endpoints.updatePlanItem.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'POLICY_BLOCKED',
              message: 'That change is blocked by your policy.',
              retryable: false,
              policyChecks: [
                { rule: 'costCeiling', result: 'blocked', detail: 'Another rule the server found' },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );
    await apply();
    expect(await screen.findByRole('alert')).toHaveTextContent('Another rule the server found');
    expect(screen.getByText('saving: none')).toBeInTheDocument();
  });

  it('shows a PayPal failure with its debug ID and changes nothing', async () => {
    setup('Harbor & Co', 'discountPct', '1.0');
    server.use(
      http.patch(endpoints.updatePlanItem.path, () =>
        HttpResponse.json(
          {
            error: {
              code: 'PAYPAL_ERROR',
              message: 'PayPal could not be reached.',
              retryable: true,
              paypal: { debugId: 'dbg-edit', name: null, message: 'x', httpStatus: 503 },
            },
          },
          { status: 502 },
        ),
      ),
    );
    await apply();
    expect(await screen.findByRole('alert')).toHaveTextContent('dbg-edit');
    expect(screen.queryByText('Harbor & Co updated')).not.toBeInTheDocument();
    expect(screen.getByText('planned cost: 54.00')).toBeInTheDocument();
  });
});
