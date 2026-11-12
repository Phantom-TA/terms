import { type ApprovalView } from '@terms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useServerEvent } from '../../api/StreamProvider';
import { negotiationKeys } from '../negotiation/queries';
import { workbenchKeys } from '../workbench/queries';
import { payablesKeys } from '../payables/queries';

export const approvalKeys = { all: ['approvals'] as const };

/** Approvals addressed to the session's business: the owner's, or a person's at the client. */
export function useApprovals() {
  return useQuery({
    queryKey: approvalKeys.all,
    queryFn: async () => (await api('listApprovals', {})).approvals,
  });
}

export function pendingApprovals(approvals: readonly ApprovalView[]): ApprovalView[] {
  return approvals.filter((a) => a.decision === 'PENDING');
}

/** Keeps the approvals and the count in the navigation current. Mounted once, in the shell. */
export function useApprovalsLive(): void {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: approvalKeys.all });
  useServerEvent('approval.requested', refresh);
  useServerEvent('approval.decided', refresh);
}

export interface DecideVariables {
  approvalId: string;
  dealId: string | null;
  decision: 'APPROVED' | 'REJECTED';
}

/** Decides a pending approval. Everything it could change is fetched again before it settles. */
export function useDecideApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, decision }: DecideVariables) =>
      api('decideApproval', { params: { approvalId }, body: { decision } }),
    // Settled, not success: a refusal often means the card is out of date.
    onSettled: async (_result, _error, { dealId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: approvalKeys.all }),
        queryClient.invalidateQueries({ queryKey: negotiationKeys.deals }),
        queryClient.invalidateQueries({ queryKey: payablesKeys.all }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.goal }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: workbenchKeys.runway }),
        ...(dealId
          ? [
              queryClient.invalidateQueries({ queryKey: workbenchKeys.deal(dealId) }),
              queryClient.invalidateQueries({ queryKey: negotiationKeys.audit(dealId) }),
            ]
          : []),
      ]);
    },
  });
}
