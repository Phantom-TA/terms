import { type DealState, type DealSummary } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import { negotiableDeals, selectedDealId, sortDeals } from './deals';

function deal(id: string, state: DealState, updatedAt: string, action = 'NEGOTIATE'): DealSummary {
  return { id, state, updatedAt, action } as DealSummary;
}

const ids = (deals: readonly DealSummary[]) => deals.map((d) => d.id);

describe('negotiableDeals', () => {
  it('leaves out reminders, which have nothing to negotiate', () => {
    const deals = [deal('a', 'SENT', 't', 'REMINDER'), deal('b', 'SENT', 't', 'EARLY_DISCOUNT')];
    expect(ids(negotiableDeals(deals))).toEqual(['b']);
  });
});

describe('sortDeals', () => {
  it('puts what needs the owner first, then what is moving, then what has closed', () => {
    const sorted = sortDeals([
      deal('paid', 'PAID', '2026-11-09T12:00:00Z'),
      deal('old', 'SENT', '2026-11-09T09:00:00Z'),
      deal('new', 'AGREED', '2026-11-09T11:00:00Z'),
      deal('needs', 'NEEDS_OWNER', '2026-11-09T08:00:00Z'),
    ]);
    expect(ids(sorted)).toEqual(['needs', 'new', 'old', 'paid']);
  });

  it('does not change the list it was given', () => {
    const deals = [deal('a', 'PAID', 't'), deal('b', 'NEEDS_OWNER', 't')];
    sortDeals(deals);
    expect(ids(deals)).toEqual(['a', 'b']);
  });
});

describe('selectedDealId', () => {
  const deals = [deal('first', 'NEEDS_OWNER', 't'), deal('second', 'SENT', 't')];

  it('uses the deal the address names', () => {
    expect(selectedDealId(deals, 'second')).toBe('second');
  });

  it('falls back to the most pressing deal for an unknown or missing one', () => {
    expect(selectedDealId(deals, 'gone')).toBe('first');
    expect(selectedDealId(deals, null)).toBe('first');
  });

  it('is empty when there is nothing to show', () => {
    expect(selectedDealId([], 'x')).toBeNull();
  });
});
