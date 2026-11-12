import {
  type DealDetail,
  type ListAuditResponse,
  type ListDealsResponse,
  type ServerEventOf,
} from '@terms/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockWorld } from '../../mocks/world';
import { applyAuditEntry, applyDealToDetail, applyDealToList, applyMessage } from './live';

let world: MockWorld;
let detail: DealDetail;

beforeEach(() => {
  world = new MockWorld();
  world.parseGoal("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
  world.createPlan();
  world.approve('60.00');
  world.startNegotiation();
  detail = world.dealDetail('deal_harbor')!;
});

const AT = '2026-11-09T12:00:00Z';

function messageEvent(id: string, dealId = 'deal_harbor'): ServerEventOf<'negotiation.message'> {
  const message = { ...detail.messages[0]!, id, dealId };
  return { id: `e-${id}`, type: 'negotiation.message', at: AT, data: { message } };
}

describe('applyMessage', () => {
  it('adds a new message at the end', () => {
    const next = applyMessage(detail, messageEvent('new'))!;
    expect(next.messages.at(-1)?.id).toBe('new');
    expect(next.messages).toHaveLength(detail.messages.length + 1);
  });

  it('does not add the same message twice', () => {
    const event = messageEvent(detail.messages[0]!.id);
    expect(applyMessage(detail, event)).toBe(detail);
  });

  it('ignores a message for another deal', () => {
    expect(applyMessage(detail, messageEvent('x', 'deal_juniper'))).toBe(detail);
  });

  it('does nothing before the first load', () => {
    expect(applyMessage(undefined, messageEvent('x'))).toBeUndefined();
  });
});

describe('deal updates', () => {
  const dealEvent = (state: 'AGREED'): ServerEventOf<'deal.updated'> => ({
    id: 'e',
    type: 'deal.updated',
    at: AT,
    data: { deal: { ...detail, state } },
  });

  it('updates the conversation’s deal and keeps its messages', () => {
    const next = applyDealToDetail(detail, dealEvent('AGREED'))!;
    expect(next.state).toBe('AGREED');
    expect(next.messages).toBe(detail.messages);
  });

  it('does not let a late event rewind the deal', () => {
    const newer = {
      ...detail,
      state: 'AWAITING_PAYMENT' as const,
      updatedAt: '2026-11-09T13:00:00Z',
    };
    const late: ServerEventOf<'deal.updated'> = {
      id: 'late',
      type: 'deal.updated',
      at: AT,
      data: { deal: { ...detail, state: 'SENT', updatedAt: '2026-11-09T12:00:00Z' } },
    };
    expect(applyDealToDetail(newer, late)).toBe(newer);
    const list: ListDealsResponse = { planId: 'plan_1', deals: [newer] };
    expect(applyDealToList(list, late)?.deals[0]?.state).toBe('AWAITING_PAYMENT');
  });

  it('leaves another deal’s conversation alone', () => {
    const other = world.dealDetail('deal_juniper')!;
    expect(applyDealToDetail(other, dealEvent('AGREED'))).toBe(other);
  });

  it('replaces the deal in the list, or adds one it has not seen', () => {
    const list: ListDealsResponse = { planId: 'plan_1', deals: [...world.deals.values()] };
    const replaced = applyDealToList(list, dealEvent('AGREED'))!;
    expect(replaced.deals).toHaveLength(list.deals.length);
    expect(replaced.deals.find((d) => d.id === 'deal_harbor')?.state).toBe('AGREED');
    const added = applyDealToList({ planId: 'plan_1', deals: [] }, dealEvent('AGREED'))!;
    expect(added.deals).toHaveLength(1);
  });
});

describe('applyAuditEntry', () => {
  const list: ListAuditResponse = { entries: [], nextCursor: null };
  const event = (id: string): ServerEventOf<'audit.appended'> => ({
    id: `e-${id}`,
    type: 'audit.appended',
    at: AT,
    data: { entry: { ...world.auditFor('deal_juniper')[0]!, id } },
  });

  it('puts the newest entry first', () => {
    const once = applyAuditEntry(list, event('one'))!;
    expect(applyAuditEntry(once, event('two'))?.entries.map((e) => e.id)).toEqual(['two', 'one']);
  });

  it('does not add the same entry twice', () => {
    const once = applyAuditEntry(list, event('one'))!;
    expect(applyAuditEntry(once, event('one'))).toBe(once);
  });
});
