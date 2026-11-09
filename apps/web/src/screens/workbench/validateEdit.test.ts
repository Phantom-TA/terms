import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld } from '../../mocks/world';
import { toWorkbenchRows, type WorkbenchRow } from './rows';
import { allowedActions, approvalNote, checkRowEdit, type EditContext } from './validateEdit';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

let rows: Record<string, WorkbenchRow>;
let context: EditContext;

beforeEach(() => {
  const world = new MockWorld();
  const goal = world.parseGoal(SENTENCE);
  const plan = world.createPlan();
  rows = Object.fromEntries(
    toWorkbenchRows(world.invoiceRows(), 'DRAFT').map((r) => [r.clientName, r]),
  );
  context = {
    maxDiscountPct: goal.maxDiscountPct,
    openingDiscountPct: goal.openingDiscountPct,
    doNotContactIds: goal.doNotContact.flatMap((d) => (d.businessId ? [d.businessId] : [])),
    costCeiling: plan.costCeiling,
    plannedCost: plan.summary.plannedCost,
    today: '2026-11-09',
  };
});

describe('checkRowEdit: discount', () => {
  it('accepts a discount within the maximum', () => {
    const result = checkRowEdit(rows['Harbor & Co']!, 'discountPct', '1.0', context);
    expect(result).toMatchObject({ ok: true, patch: { discountPct: '1.00' } });
  });

  it('blocks a discount above the maximum and says why', () => {
    const result = checkRowEdit(rows['Harbor & Co']!, 'discountPct', '1.5', context);
    expect(result).toMatchObject({ ok: false, message: '1.50% is above the 1.20% maximum' });
  });

  it('allows going over the cost ceiling but flags that approval is needed', () => {
    const result = checkRowEdit(rows['Harbor & Co']!, 'discountPct', '1.2', context);
    expect(result.ok).toBe(true);
    expect(approvalNote(result.checks)).toMatch(/\$1\.00 over the \$60\.00 ceiling/);
  });

  it('does not flag a change that stays under the ceiling', () => {
    const result = checkRowEdit(rows['Harbor & Co']!, 'discountPct', '0.5', context);
    expect(result.ok).toBe(true);
    expect(approvalNote(result.checks)).toBeNull();
  });

  it('rejects text that is not a percentage', () => {
    expect(checkRowEdit(rows['Harbor & Co']!, 'discountPct', 'lots', context)).toMatchObject({
      ok: false,
      message: 'Enter a percentage like 1.2.',
    });
  });

  it('refuses a discount on a row with no offer', () => {
    expect(checkRowEdit(rows['Oak Street Bakery']!, 'discountPct', '0.5', context)).toMatchObject({
      ok: false,
      message: 'Choose an offer action before setting a discount.',
    });
  });
});

describe('checkRowEdit: amount', () => {
  it('accepts an amount within what is still due', () => {
    expect(checkRowEdit(rows['Harbor & Co']!, 'amountEarly', '$2,000', context)).toMatchObject({
      ok: true,
      patch: { amountEarly: '2000.00' },
    });
  });

  it('blocks an amount above the invoice', () => {
    const result = checkRowEdit(rows['Harbor & Co']!, 'amountEarly', '9000', context);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/more than the \$7,500\.00 still due/);
  });

  it('blocks zero', () => {
    expect(checkRowEdit(rows['Harbor & Co']!, 'amountEarly', '0', context).ok).toBe(false);
  });

  it('rejects text that is not money', () => {
    expect(checkRowEdit(rows['Harbor & Co']!, 'amountEarly', 'half', context)).toMatchObject({
      ok: false,
      message: 'Enter an amount like 1750.',
    });
  });
});

describe('checkRowEdit: action', () => {
  it('refuses to message a do-not-contact client', () => {
    const result = checkRowEdit(rows['Pinecrest Dental']!, 'action', 'REMINDER', context);
    expect(result).toMatchObject({
      ok: false,
      message: 'This client is on the do-not-contact list',
    });
  });

  it('refuses a discount offer on an overdue invoice', () => {
    const result = checkRowEdit(rows['Oak Street Bakery']!, 'action', 'EARLY_DISCOUNT', context);
    expect(result.ok).toBe(false);
  });

  it('fills a default opening discount and the full amount when switching to an offer', () => {
    const result = checkRowEdit(rows['Juniper Labs']!, 'action', 'EARLY_DISCOUNT', context);
    expect(result).toMatchObject({ ok: true, patch: { action: 'EARLY_DISCOUNT' } });
  });

  it('lets the owner exclude a row', () => {
    expect(checkRowEdit(rows['Juniper Labs']!, 'action', 'NONE', context)).toMatchObject({
      ok: true,
      patch: { action: 'NONE' },
    });
  });

  it('says so when nothing would change', () => {
    expect(checkRowEdit(rows['Juniper Labs']!, 'action', 'NEGOTIATE', context)).toMatchObject({
      ok: false,
    });
  });
});

describe('checkRowEdit: the action has to fit the amount', () => {
  it('asks for the whole invoice when switching to an early-payment discount', () => {
    expect(checkRowEdit(rows['Harbor & Co']!, 'action', 'EARLY_DISCOUNT', context)).toMatchObject({
      ok: true,
      patch: { action: 'EARLY_DISCOUNT', amountEarly: '7500.00' },
    });
  });

  it('asks for half, in $250 steps, when a whole-invoice row becomes a partial payment', () => {
    expect(checkRowEdit(rows['Juniper Labs']!, 'action', 'PARTIAL_PAYMENT', context)).toMatchObject(
      {
        ok: true,
        patch: { action: 'PARTIAL_PAYMENT', amountEarly: '2500.00' },
      },
    );
  });

  it('keeps an amount that is already partial', () => {
    const result = checkRowEdit(rows['Harbor & Co']!, 'action', 'PARTIAL_PAYMENT', context);
    expect(result).toMatchObject({ ok: true, patch: { action: 'PARTIAL_PAYMENT' } });
    expect(result.ok && result.patch.amountEarly).toBeUndefined();
  });

  it('refuses part of an invoice on an early-payment discount', () => {
    const row = { ...rows['Juniper Labs']!, action: 'EARLY_DISCOUNT' as const };
    expect(checkRowEdit(row, 'amountEarly', '1000', context)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Use Partial payment') as string,
    });
  });

  it('refuses the whole invoice on a partial payment', () => {
    const row = { ...rows['Harbor & Co']!, action: 'PARTIAL_PAYMENT' as const };
    expect(checkRowEdit(row, 'amountEarly', '7500', context)).toMatchObject({
      ok: false,
      message: expect.stringContaining('Early-payment discount') as string,
    });
  });
});

describe('allowedActions', () => {
  it('offers negotiation only to clients that run an agent', () => {
    expect(allowedActions({ hasAgent: true })).toContain('NEGOTIATE');
    expect(allowedActions({ hasAgent: false })).not.toContain('NEGOTIATE');
    expect(allowedActions({ hasAgent: false })).toContain('REMINDER');
  });
});
