import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld } from '../../mocks/world';
import { PROTECTED_GROUP, toSummaryRow, toWorkbenchRows } from './rows';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

let world: MockWorld;
beforeEach(() => {
  world = new MockWorld();
  world.parseGoal(SENTENCE);
  world.createPlan();
});

const byClient = (rows: ReturnType<typeof toWorkbenchRows>) =>
  Object.fromEntries(rows.map((r) => [r.clientName, r]));

describe('toWorkbenchRows', () => {
  it('makes one row per invoice with the server’s figures', () => {
    const rows = toWorkbenchRows(world.invoiceRows(), 'DRAFT');
    expect(rows).toHaveLength(5);
    const juniper = byClient(rows)['Juniper Labs']!;
    expect(juniper).toMatchObject({
      number: '1041',
      amountDue: '5000.00',
      action: 'NEGOTIATE',
      amountEarly: '5000.00',
      discountPct: '0.80',
      rate: '16.4',
      cost: '40.00',
      ifAgreed: '4960.00',
      dealState: 'SUGGESTED',
      groupLabel: 'Negotiate',
      hasAgent: true,
    });
  });

  it('shows no committed cash until the server says a deal counts', () => {
    const rows = toWorkbenchRows(world.invoiceRows(), 'DRAFT');
    expect(rows.every((r) => r.committed === null)).toBe(true);
    expect(byClient(rows)['Juniper Labs']?.ifAgreed).toBe('4960.00');
  });

  it('copies committed cash from a deal the server counts as committed', () => {
    const invoices = world
      .invoiceRows()
      .map((row) =>
        row.id === 'inv_juniper' && row.deal
          ? { ...row, deal: { ...row.deal, state: 'AGREED' as const, countsAsCommitted: true } }
          : row,
      );
    const rows = toWorkbenchRows(invoices, 'APPROVED');
    expect(byClient(rows)['Juniper Labs']?.committed).toBe('4960.00');
    expect(byClient(rows)['Harbor & Co']?.committed).toBeNull();
  });

  it('marks a reminder as best effort and never as committed', () => {
    const oak = byClient(toWorkbenchRows(world.invoiceRows(), 'DRAFT'))['Oak Street Bakery']!;
    expect(oak).toMatchObject({
      action: 'REMINDER',
      bestEffort: true,
      committed: null,
      ifAgreed: '0.00',
    });
  });

  it('groups protected clients apart, whatever their action', () => {
    const rows = byClient(toWorkbenchRows(world.invoiceRows(), 'DRAFT'));
    expect(rows['Pinecrest Dental']).toMatchObject({
      contactAllowed: false,
      groupLabel: PROTECTED_GROUP,
    });
    expect(rows['Birch Legal']).toMatchObject({
      contactAllowed: false,
      groupLabel: PROTECTED_GROUP,
    });
    expect(rows['Oak Street Bakery']?.groupLabel).toBe('Reminder');
  });

  it('says what is awaiting approval', () => {
    const draft = byClient(toWorkbenchRows(world.invoiceRows(), 'DRAFT'));
    expect(draft['Juniper Labs']?.approval).toBe('awaiting-plan');
    expect(draft['Pinecrest Dental']?.approval).toBeNull();
    const approved = byClient(toWorkbenchRows(world.invoiceRows(), 'APPROVED'));
    expect(approved['Juniper Labs']?.approval).toBe('approved');
  });

  it('flags a row that needs the owner now', () => {
    const invoices = world.invoiceRows().map((row) =>
      row.id === 'inv_harbor' && row.deal
        ? {
            ...row,
            deal: { ...row.deal, state: 'NEEDS_OWNER' as const, pendingApprovalId: 'appr_1' },
          }
        : row,
    );
    expect(byClient(toWorkbenchRows(invoices, 'APPROVED'))['Harbor & Co']?.approval).toBe(
      'needs-you',
    );
  });

  it('has no plan columns when there is no plan', () => {
    const fresh = new MockWorld();
    fresh.parseGoal(SENTENCE);
    const rows = toWorkbenchRows(fresh.invoiceRows(), null);
    expect(
      rows.every((r) => r.action === 'NONE' && r.approval === null && r.dealState === null),
    ).toBe(true);
  });
});

describe('toSummaryRow', () => {
  it('uses the server’s plan totals', () => {
    const summary = toSummaryRow(world.plan!.summary);
    expect(summary).toMatchObject({
      kind: 'summary',
      label: 'Plan total',
      cost: '54.00',
      ifAgreed: '6696.00',
      committed: '0.00',
    });
  });
});
