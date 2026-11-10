import { type DealState, type DealSummary } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import { negotiableDeals, nextAutoDealId, selectedDealId, sortDeals } from './deals';

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

describe('nextAutoDealId', () => {
  const a = deal('a', 'SENT', 't');
  const b = deal('b', 'SENT', 't');
  const needs = deal('n', 'NEEDS_OWNER', 't');
  const alsoNeeds = deal('m', 'NEEDS_OWNER', 't');

  it('starts on the first deal', () => {
    expect(nextAutoDealId([a, b], null)).toBe('a');
  });

  it('stays put when live updates reorder the list', () => {
    expect(nextAutoDealId([b, a], 'a')).toBe('a');
  });

  it('moves to something that needs the owner', () => {
    expect(nextAutoDealId([needs, a], 'a')).toBe('n');
  });

  it('does not bounce between two deals that both need the owner', () => {
    expect(nextAutoDealId([alsoNeeds, needs], 'n')).toBe('n');
  });

  it('moves on when the open deal has gone', () => {
    expect(nextAutoDealId([a], 'gone')).toBe('a');
    expect(nextAutoDealId([], 'gone')).toBeNull();
  });
});

describe('selectedDealId', () => {
  const deals = [deal('first', 'NEEDS_OWNER', 't'), deal('second', 'SENT', 't')];

  it('uses the deal the address names', () => {
    expect(selectedDealId(deals, 'second', 'first')).toBe('second');
  });

  it('falls back to the automatic one for an unknown or missing deal', () => {
    expect(selectedDealId(deals, 'gone', 'first')).toBe('first');
    expect(selectedDealId(deals, null, 'first')).toBe('first');
  });
});
