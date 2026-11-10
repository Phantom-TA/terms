import { type OfferReplyRequest } from '@terms/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export const offerKey = (token: string) => ['public-offer', token] as const;

/** The offer behind a link. Looking does not use the link up; replying does. */
export function usePublicOffer(token: string) {
  return useQuery({
    queryKey: offerKey(token),
    queryFn: async () => (await api('getPublicOffer', { params: { token } })).offer,
  });
}

/** The page keeps the server's answer itself, so its message stays on screen after the offer closes. */
export function useReplyToOffer(token: string) {
  return useMutation({
    mutationFn: (body: OfferReplyRequest) => api('replyPublicOffer', { params: { token }, body }),
  });
}
