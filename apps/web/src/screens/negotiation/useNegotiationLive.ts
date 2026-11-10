import { type DealDetail, type ListAuditResponse, type ListDealsResponse } from '@terms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useServerEvent } from '../../api/StreamProvider';
import { useApplyEvent } from '../../api/useApplyEvent';
import { describeGoalMet } from '../../lib/display';
import { useToast } from '../../ui/Toast';
import { workbenchKeys } from '../workbench/queries';
import { applyAuditEntry, applyDealToDetail, applyDealToList, applyMessage } from './live';
import { negotiationKeys } from './queries';

/** Keeps the Negotiation Room current. Messages, states and PayPal steps arrive as they happen. */
export function useNegotiationLive(): void {
  const queryClient = useQueryClient();
  const applyEvent = useApplyEvent();
  const { toast } = useToast();

  useServerEvent('negotiation.message', (event) => {
    applyEvent<DealDetail>(workbenchKeys.deal(event.data.message.dealId), (old) =>
      applyMessage(old, event),
    );
  });

  useServerEvent('deal.updated', (event) => {
    applyEvent<ListDealsResponse>(negotiationKeys.deals, (old) => applyDealToList(old, event));
    applyEvent<DealDetail>(workbenchKeys.deal(event.data.deal.id), (old) =>
      applyDealToDetail(old, event),
    );
  });

  useServerEvent('audit.appended', (event) => {
    const { dealId } = event.data.entry;
    if (dealId === null) return;
    applyEvent<ListAuditResponse>(negotiationKeys.audit(dealId), (old) =>
      applyAuditEntry(old, event),
    );
  });

  // The approval's own fields aren't on the deal, so fetch them again.
  const refreshApproval = (dealId: string | null) => {
    if (dealId) void queryClient.invalidateQueries({ queryKey: workbenchKeys.deal(dealId) });
    void queryClient.invalidateQueries({ queryKey: negotiationKeys.deals });
  };
  useServerEvent('approval.requested', (event) => {
    refreshApproval(event.data.approval.dealId);
  });
  useServerEvent('approval.decided', (event) => {
    refreshApproval(event.data.approval.dealId);
  });

  useServerEvent('goal.met', (event) => {
    toast({
      tone: 'success',
      title: 'Goal met',
      description: describeGoalMet(event.data.committed, event.data.target, event.data.cost),
    });
  });
}
