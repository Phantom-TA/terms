import {
  type DealDetail,
  type ListAuditResponse,
  type ListDealsResponse,
  type ServerEventOf,
} from '@terms/shared';

/** Pure reducers that fold server events into the Negotiation Room's cached data. */

export function applyMessage(
  old: DealDetail | undefined,
  event: ServerEventOf<'negotiation.message'>,
): DealDetail | undefined {
  const { message } = event.data;
  if (old?.id !== message.dealId || old.messages.some((m) => m.id === message.id)) return old;
  return { ...old, messages: [...old.messages, message] };
}

export function applyDealToDetail(
  old: DealDetail | undefined,
  event: ServerEventOf<'deal.updated'>,
): DealDetail | undefined {
  const { deal } = event.data;
  return old?.id === deal.id ? { ...old, ...deal } : old;
}

export function applyDealToList(
  old: ListDealsResponse | undefined,
  event: ServerEventOf<'deal.updated'>,
): ListDealsResponse | undefined {
  if (!old) return old;
  const { deal } = event.data;
  return {
    ...old,
    deals: old.deals.some((d) => d.id === deal.id)
      ? old.deals.map((d) => (d.id === deal.id ? deal : d))
      : [...old.deals, deal],
  };
}

export function applyAuditEntry(
  old: ListAuditResponse | undefined,
  event: ServerEventOf<'audit.appended'>,
): ListAuditResponse | undefined {
  const { entry } = event.data;
  if (!old || old.entries.some((e) => e.id === entry.id)) return old;
  return { ...old, entries: [entry, ...old.entries] };
}
