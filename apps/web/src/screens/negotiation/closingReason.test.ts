import { type DealDetail, type DealTransition } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import { closingReason } from './closingReason';

function deal(
  state: DealDetail['state'],
  history: Partial<DealTransition>[],
  closed: string | null,
) {
  return {
    state,
    closedReason: closed,
    history: history.map((h) => ({
      from: null,
      to: state,
      actor: 'OWNER',
      reason: '',
      at: '2026-11-09T10:00:00Z',
      ...h,
    })),
  } as unknown as DealDetail;
}

describe('why a deal closed', () => {
  it('gives this side its own reason for its own move', () => {
    expect(
      closingReason(deal('DECLINED', [{ reason: 'You rejected the counter.' }], 'Declined')),
    ).toBe('You rejected the counter.');
  });

  it('says nothing more when all this side knows is the public word for the state', () => {
    expect(closingReason(deal('DECLINED', [{ reason: 'Declined' }], 'Declined'))).toBeNull();
  });

  it('falls back to the public reason when the history has no step into the state', () => {
    expect(closingReason(deal('FAILED', [], 'PayPal refused the invoice update'))).toBe(
      'PayPal refused the invoice update',
    );
  });

  it('says nothing for a deal that is still open', () => {
    expect(closingReason(deal('SENT', [{ reason: 'Countered' }], null))).toBeNull();
  });
});
