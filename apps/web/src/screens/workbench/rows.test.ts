import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld } from '../../mocks/world';
import {
  belongsOnWorkbench,
  groupRank,
  PROTECTED_GROUP,
  toSummaryRow,
  toWorkbenchRows,
} from './rows';

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
    world.approve('60.00');
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
    world.approve('60.00');
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

  it('never calls a row in a cancelled plan approved', () => {
    world.approve('60.00');
    const rows = byClient(toWorkbenchRows(world.invoiceRows(), 'CANCELLED'));
    expect(rows['Juniper Labs']?.approval).toBeNull();
  });

  it('shows a draft row as suggested, though deals only exist after approval', () => {
    const rows = byClient(toWorkbenchRows(world.invoiceRows(), 'DRAFT'));
    expect(rows['Juniper Labs']?.dealId).toBeNull();
    expect(rows['Juniper Labs']?.dealState).toBe('SUGGESTED');
    expect(rows['Pinecrest Dental']?.dealState).toBeNull();
  });

  it('keeps paid invoices from the plan and drops closed ones that are not', () => {
    const [first, second] = world.invoiceRows();
    const paidInPlan = { ...first!, paypalStatus: 'PAID' as const };
    const paidElsewhere = {
      ...second!,
      id: 'inv_old',
      planItem: null,
      paypalStatus: 'PAID' as const,
    };
    expect(belongsOnWorkbench(paidInPlan)).toBe(true);
    expect(belongsOnWorkbench(paidElsewhere)).toBe(false);
    expect(toWorkbenchRows([paidInPlan, paidElsewhere], 'APPROVED').map((r) => r.id)).toEqual([
      paidInPlan.id,
    ]);
  });

  it('keeps the same row object for an unchanged invoice, so an open editor survives', () => {
    const invoices = world.invoiceRows();
    const first = toWorkbenchRows(invoices, 'DRAFT');
    expect(toWorkbenchRows(invoices, 'DRAFT')[0]).toBe(first[0]);
    expect(toWorkbenchRows(invoices, 'APPROVED')[0]).not.toBe(first[0]);
  });

  it('carries the server’s policy checks', () => {
    const rows = byClient(toWorkbenchRows(world.invoiceRows(), 'DRAFT'));
    expect(rows['Pinecrest Dental']?.policyChecks[0]).toMatchObject({
      rule: 'doNotContact',
      result: 'blocked',
    });
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

describe('groupRank', () => {
  it('lists offers first and protected clients last', () => {
    const order = [
      'Do not contact',
      'No action',
      'Reminder',
      'Negotiate',
      'Early-payment discount',
    ].sort((a, b) => groupRank(a) - groupRank(b));
    expect(order.slice(0, 2).sort()).toEqual(['Early-payment discount', 'Negotiate']);
    expect(order.slice(2)).toEqual(['Reminder', 'No action', 'Do not contact']);
  });
});
