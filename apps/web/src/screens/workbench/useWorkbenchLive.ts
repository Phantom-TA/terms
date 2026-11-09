import { formatMoney } from '@terms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useServerEvent } from '../../api/StreamProvider';
import { useToast } from '../../ui/Toast';
import {
  applyDealUpdated,
  applyInvoiceUpdated,
  applyPlanUpdated,
  applyRunwayUpdated,
} from './live';
import {
  type CurrentGoalResponse,
  type ListInvoicesResponse,
  type RunwayResponse,
} from './queries';
import { workbenchKeys } from './queries';

/**
 * Keeps the Workbench current. Each server event is folded into the cached data, so a deal turning
 * committed, a payment landing or the runway moving shows up without a reload. The figures are the
 * server's; this hook never works out a payment outcome itself.
 */
export function useWorkbenchLive(): void {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useServerEvent('invoice.updated', (event) => {
    queryClient.setQueryData<ListInvoicesResponse>(workbenchKeys.invoices, (old) =>
      applyInvoiceUpdated(old, event),
    );
  });

  useServerEvent('deal.updated', (event) => {
    queryClient.setQueryData<ListInvoicesResponse>(workbenchKeys.invoices, (old) =>
      applyDealUpdated(old, event),
    );
    // The transcript behind an open row may have a new message or state.
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.deal(event.data.deal.id) });
  });

  useServerEvent('plan.updated', (event) => {
    queryClient.setQueryData<CurrentGoalResponse>(workbenchKeys.goal, (old) =>
      applyPlanUpdated(old, event),
    );
  });

  useServerEvent('runway.updated', (event) => {
    queryClient.setQueryData<RunwayResponse>(workbenchKeys.runway, (old) =>
      applyRunwayUpdated(old, event),
    );
  });

  useServerEvent('negotiation.message', (event) => {
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.deal(event.data.message.dealId) });
  });

  useServerEvent('goal.met', (event) => {
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.goal });
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
    toast({
      tone: 'success',
      title: 'Goal met',
      description: `${formatMoney(event.data.committed)} is committed against a ${formatMoney(event.data.target)} target, for ${formatMoney(event.data.cost)}. Offers that are no longer needed were withdrawn.`,
    });
  });

  useServerEvent('approval.requested', (event) => {
    if (event.data.approval.requestedFrom !== 'OWNER') return;
    toast({
      tone: 'info',
      title: 'Needs your approval',
      description: event.data.approval.title,
    });
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
  });

  useServerEvent('sync.completed', () => {
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
    void queryClient.invalidateQueries({ queryKey: workbenchKeys.runway });
  });
}
