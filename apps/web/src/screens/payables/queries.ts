import { type VaultResponse } from '@terms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useServerEvent } from '../../api/StreamProvider';

export type OfferStatus = 'OPEN' | 'CLOSED' | 'ALL';

export const payablesKeys = {
  offers: (status: OfferStatus) => ['client-offers', status] as const,
  vault: ['client-vault'] as const,
};

/** Incoming offers, ranked by annualised return by the server. */
export function useClientOffers(status: OfferStatus) {
  return useQuery({
    queryKey: payablesKeys.offers(status),
    queryFn: () => api('listClientOffers', { query: { status } }),
  });
}

export function useVault() {
  return useQuery({
    queryKey: payablesKeys.vault,
    queryFn: async () => (await api('getClientVault')).vault,
  });
}

/** Starts saving the client's PayPal method. A person then approves it on PayPal. */
export function useVaultSetup() {
  return useMutation({ mutationFn: () => api('clientVaultSetup', { body: {} }) });
}

/** Finishes saving after the person comes back from PayPal. */
export function useVaultConfirm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (setupTokenId: string) => api('clientVaultConfirm', { body: { setupTokenId } }),
    onSuccess: ({ vault }) => {
      queryClient.setQueryData<VaultResponse['vault']>(payablesKeys.vault, vault);
    },
  });
}

/** Offers change as the agents negotiate and PayPal confirms. */
export function usePayablesLive(): void {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['client-offers'] });
  useServerEvent('deal.updated', refresh);
  useServerEvent('negotiation.message', refresh);
}
