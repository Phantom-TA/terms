import { ListInvoicesResponse } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import { currentWorld } from '../../mocks/handlers';
import { installMockApi } from '../../test/msw';
import { invoiceRecords, runwayRecords, studioSources } from './studioData';

installMockApi();

function invoices(): ListInvoicesResponse {
  return ListInvoicesResponse.parse({
    rows: currentWorld().invoiceRows(),
    planId: null,
    today: '2026-11-09',
    lastSyncedAt: null,
    demo: true,
  });
}

describe('the owner’s data as Studio tables', () => {
  it('gives each invoice the server’s figures, with its plan row and deal', () => {
    const world = currentWorld();
    world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
    world.createPlan();
    const records = invoiceRecords(invoices());
    const harbor = records.find((r) => r.client === 'Harbor & Co');
    const row = currentWorld()
      .invoiceRows()
      .find((r) => r.client.name === 'Harbor & Co')!;
    expect(harbor).toMatchObject({
      invoice: row.number,
      amountDue: Number(row.amountDue),
      action: row.planItem?.action,
      planCost: Number(row.planItem?.cost),
      dealState: row.deal?.state ?? 'NONE',
    });
  });

  it('marks an invoice outside any plan as having no action', () => {
    expect(invoiceRecords(invoices()).every((r) => r.action === 'NONE' && r.planCost === 0)).toBe(
      true,
    );
  });

  it('gives each runway day its three balances', () => {
    const runway = currentWorld().runway();
    const records = runwayRecords(runway);
    expect(records).toHaveLength(runway.points.length);
    expect(records[0]).toEqual({
      date: runway.points[0]!.date,
      before: Number(runway.points[0]!.before),
      afterCommitted: Number(runway.points[0]!.afterCommitted),
      afterPlanned: Number(runway.points[0]!.afterPlanned),
    });
  });

  it('keeps the runway table, empty, when the runway is not available', () => {
    const sources = studioSources(invoices(), null).sources;
    expect(sources.map((s) => s.id)).toEqual(['invoices', 'runway']);
    expect(sources[1]).toMatchObject({ data: [] });
  });
});
