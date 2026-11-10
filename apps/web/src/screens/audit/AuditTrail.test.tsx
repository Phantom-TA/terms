import { type AuditEntry, endpoints } from '@terms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { server } from '../../mocks/server';
import { installMockApi } from '../../test/msw';
import { renderWithProviders } from '../../test/renderWithProviders';
import { Component as AuditTrail } from './AuditTrail';

// The real grid is exercised in the browser (e2e/audit.spec.ts). Here it lists what it was given.
vi.mock('./AuditGrid', () => ({
  AuditGrid: ({ entries, search }: { entries: readonly AuditEntry[]; search: string }) => (
    <ol data-testid="audit-grid" data-search={search}>
      {entries.map((e) => (
        <li key={e.id}>
          {e.actor} {e.action} {e.summary}
        </li>
      ))}
    </ol>
  ),
}));

installMockApi();

function negotiated() {
  const world = currentWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  world.approve('60.00');
  world.startNegotiation();
}

function renderAudit() {
  return renderWithProviders(
    <MemoryRouter>
      <main>
        <AuditTrail />
      </main>
    </MemoryRouter>,
  );
}

describe('Audit trail', () => {
  it('shows skeletons while loading', async () => {
    server.use(
      http.get(endpoints.listAudit.path, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderAudit();
    expect(await screen.findByText('Loading the audit trail')).toBeInTheDocument();
  });

  it('shows the real error with its debug ID, and recovers on retry', async () => {
    server.use(
      http.get(
        endpoints.listAudit.path,
        () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'The log is unavailable.', retryable: true } },
            { status: 500, headers: { 'x-request-id': 'req-audit' } },
          ),
        { once: true },
      ),
    );
    renderAudit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The log is unavailable.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Nothing recorded yet' }),
    ).toBeInTheDocument();
  });

  it('lists every step, newest first', async () => {
    negotiated();
    const { container } = renderAudit();
    const grid = await screen.findByTestId('audit-grid');
    const items = within(grid).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(10);
    expect(items.at(-1)).toHaveTextContent('GOAL_PARSED');
    expect(screen.getByText(`${items.length} entries shown`)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks the server for just one actor or action', async () => {
    negotiated();
    renderAudit();
    await screen.findByTestId('audit-grid');
    await userEvent.selectOptions(screen.getByLabelText('Who'), 'Owner');
    await vi.waitFor(() => {
      const items = within(screen.getByTestId('audit-grid')).getAllByRole('listitem');
      expect(items.every((li) => li.textContent.startsWith('OWNER'))).toBe(true);
    });
    await userEvent.selectOptions(screen.getByLabelText('What'), 'Webhook rejected');
    expect(await screen.findByRole('heading', { name: 'No matching entries' })).toBeInTheDocument();
  });

  it('passes the search to the grid', async () => {
    negotiated();
    renderAudit();
    await screen.findByTestId('audit-grid');
    await userEvent.type(screen.getByLabelText('Search these entries'), 'Harbor');
    expect(screen.getByTestId('audit-grid')).toHaveAttribute('data-search', 'Harbor');
  });

  it('loads older entries on request', async () => {
    negotiated();
    const all = currentWorld().auditLog.toReversed();
    server.use(
      http.get(endpoints.listAudit.path, ({ request }) => {
        const older = new URL(request.url).searchParams.get('cursor') === 'older';
        return HttpResponse.json(
          older
            ? { entries: all.slice(3), nextCursor: null }
            : { entries: all.slice(0, 3), nextCursor: 'older' },
        );
      }),
    );
    renderAudit();
    expect(await screen.findByText('3 entries shown')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText(`${all.length} entries shown`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older entries' })).not.toBeInTheDocument();
  });
});
