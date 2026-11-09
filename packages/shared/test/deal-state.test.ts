import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canActorTransition,
  canTransition,
  COMMITTED_STATES,
  DEAL_TRANSITIONS,
  FINAL_STATES,
  IllegalTransitionError,
  isCommitted,
  isFinal,
  isOpenOffer,
} from '../src/deal-state.js';
import { Actor, DealState } from '../src/enums.js';

describe('deal state machine', () => {
  it('defines transitions for every state', () => {
    expect(Object.keys(DEAL_TRANSITIONS).sort()).toEqual([...DealState.options].sort());
  });

  it('allows the CONTEXT.md happy path', () => {
    const path: DealState[] = [
      'SUGGESTED',
      'APPROVED',
      'SENT',
      'COUNTERED',
      'NEEDS_OWNER',
      'SENT',
      'AGREED',
      'INVOICE_UPDATED',
      'AWAITING_PAYMENT',
      'PARTIALLY_PAID',
      'PAID',
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('SUGGESTED', 'SENT')).toBe(false); // must be approved first
    expect(canTransition('SENT', 'INVOICE_UPDATED')).toBe(false); // must agree first
    expect(canTransition('DECLINED', 'AGREED')).toBe(false);
    expect(canTransition('PAID', 'PARTIALLY_PAID')).toBe(false);
  });

  it('final states have no way out except PARTIALLY_PAID → PAID', () => {
    for (const s of FINAL_STATES) {
      const out = DEAL_TRANSITIONS[s];
      if (s === 'PARTIALLY_PAID') expect(out).toEqual(['PAID']);
      else expect(out).toEqual([]);
      expect(isFinal(s)).toBe(true);
    }
    expect(isFinal('SENT')).toBe(false);
  });

  it('only PayPal can mark a deal paid', () => {
    for (const actor of Actor.options) {
      expect(canActorTransition('AWAITING_PAYMENT', 'PAID', actor)).toBe(actor === 'PAYPAL');
      expect(canActorTransition('AWAITING_PAYMENT', 'PARTIALLY_PAID', actor)).toBe(
        actor === 'PAYPAL',
      );
    }
  });

  it('only the owner approves a plan row', () => {
    expect(canActorTransition('SUGGESTED', 'APPROVED', 'OWNER')).toBe(true);
    expect(canActorTransition('SUGGESTED', 'APPROVED', 'SUPPLIER_AGENT')).toBe(false);
  });

  it('agents may agree terms', () => {
    expect(canActorTransition('SENT', 'AGREED', 'CLIENT_AGENT')).toBe(true);
    expect(canActorTransition('COUNTERED', 'AGREED', 'SUPPLIER_AGENT')).toBe(true);
  });

  it('assertTransition throws a descriptive error', () => {
    expect(() => {
      assertTransition('SENT', 'PAID', 'CLIENT_AGENT');
    }).toThrow('CLIENT_AGENT may not move a deal from SENT to PAID');
    expect(() => {
      assertTransition('SUGGESTED', 'SENT', 'OWNER');
    }).toThrow(IllegalTransitionError);
    expect(() => {
      assertTransition('SUGGESTED', 'SENT', 'OWNER');
    }).toThrow('Illegal deal transition SUGGESTED → SENT');
    expect(() => {
      assertTransition('SENT', 'AGREED', 'CLIENT_AGENT');
    }).not.toThrow();
  });

  it('only agreed or paid deals count as committed cash', () => {
    expect(COMMITTED_STATES).toEqual([
      'AGREED',
      'INVOICE_UPDATED',
      'AWAITING_PAYMENT',
      'PAID',
      'PARTIALLY_PAID',
    ]);
    for (const s of ['SUGGESTED', 'APPROVED', 'SENT', 'COUNTERED', 'NEEDS_OWNER'] as const) {
      expect(isCommitted(s)).toBe(false);
    }
    expect(isCommitted('AGREED')).toBe(true);
    expect(isOpenOffer('COUNTERED')).toBe(true);
    expect(isOpenOffer('AGREED')).toBe(false);
  });
});
