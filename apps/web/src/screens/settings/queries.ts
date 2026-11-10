import {
  type ClientPolicyView,
  type PutClientPolicyRequest,
  type PutSupplierPolicyRequest,
  type SupplierPolicyView,
} from '@terms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { workbenchKeys } from '../workbench/queries';
import { payablesKeys } from '../payables/queries';

export const clientPolicyKey = ['client-policy'] as const;

export function useClientPolicy() {
  return useQuery({
    queryKey: clientPolicyKey,
    queryFn: async () => (await api('getClientPolicy')).policy,
  });
}

/** Saves the owner's policy. The form shows the server's copy once it answers. */
export function useSaveSupplierPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PutSupplierPolicyRequest) =>
      (await api('putSupplierPolicy', { body })).policy,
    onSuccess: (policy) => {
      queryClient.setQueryData<SupplierPolicyView>(workbenchKeys.policy, policy);
    },
  });
}

/** Saves the client agent's policy, which changes how its offers are judged. */
export function useSaveClientPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PutClientPolicyRequest) =>
      (await api('putClientPolicy', { body })).policy,
    onSuccess: async (policy) => {
      queryClient.setQueryData<ClientPolicyView>(clientPolicyKey, policy);
      await queryClient.invalidateQueries({ queryKey: payablesKeys.all });
    },
  });
}
