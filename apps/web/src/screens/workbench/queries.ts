import {
  type CurrentGoalResponse,
  type ListInvoicesResponse,
  type RunwayResponse,
  type UpdatePlanItemRequest,
} from '@terms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ApiError } from '../../api/errors';

export const workbenchKeys = {
  goal: ['goal', 'current'] as const,
  invoices: ['invoices'] as const,
  runway: ['runway'] as const,
  policy: ['supplier-policy'] as const,
  deal: (dealId: string) => ['deal', dealId] as const,
};

export function useCurrentGoal() {
  return useQuery({ queryKey: workbenchKeys.goal, queryFn: () => api('currentGoal') });
}

export function useInvoices() {
  return useQuery({ queryKey: workbenchKeys.invoices, queryFn: () => api('listInvoices', {}) });
}

export function useRunway() {
  return useQuery({ queryKey: workbenchKeys.runway, queryFn: () => api('getRunway', {}) });
}

export function useSupplierPolicy() {
  return useQuery({
    queryKey: workbenchKeys.policy,
    queryFn: async () => (await api('getSupplierPolicy')).policy,
  });
}

export function useDeal(dealId: string | null) {
  return useQuery({
    queryKey: workbenchKeys.deal(dealId ?? 'none'),
    queryFn: () => api('getDeal', { params: { dealId: dealId ?? '' } }),
    enabled: dealId !== null,
  });
}

/** Parse the owner's sentence. The returned goal is a draft until the owner confirms it. */
export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api('createGoal', { body: { text } }),
    onSuccess: ({ goal }) => {
      queryClient.setQueryData<CurrentGoalResponse>(workbenchKeys.goal, { goal, plan: null });
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.runway });
    },
  });
}

type GoalPatch = Parameters<typeof api<'updateGoal'>>[1] extends infer O
  ? O extends { body: infer B }
    ? B
    : never
  : never;

export function useUpdateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, patch }: { goalId: string; patch: GoalPatch }) =>
      api('updateGoal', { params: { goalId }, body: patch }),
    onSuccess: ({ goal }) => {
      queryClient.setQueryData<CurrentGoalResponse>(workbenchKeys.goal, (old) => ({
        goal,
        plan: old?.plan ?? null,
      }));
    },
  });
}

/** Runs the planner on the confirmed goal. */
export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) => api('createPlan', { params: { goalId }, body: {} }),
    onSuccess: ({ plan }) => {
      queryClient.setQueryData<CurrentGoalResponse>(workbenchKeys.goal, (old) =>
        old?.goal ? { goal: { ...old.goal, status: 'PLANNED' }, plan } : old,
      );
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.runway });
    },
  });
}

/**
 * Sends an owner's edit. The cache changes only with the server's answer, so the grid never shows
 * a plan the server didn't accept.
 */
export function useUpdatePlanItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      planId,
      itemId,
      patch,
    }: {
      planId: string;
      itemId: string;
      patch: UpdatePlanItemRequest;
    }) => api('updatePlanItem', { params: { planId, itemId }, body: patch }),
    onSuccess: ({ plan }) => {
      queryClient.setQueryData<CurrentGoalResponse>(workbenchKeys.goal, (old) =>
        old ? { ...old, plan } : old,
      );
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.runway });
    },
  });
}

export function useApprovePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, costCeiling }: { planId: string; costCeiling: string }) =>
      api('approvePlan', { params: { planId }, body: { costCeiling } }),
    onSuccess: ({ plan }) => {
      queryClient.setQueryData<CurrentGoalResponse>(workbenchKeys.goal, (old) =>
        old?.goal ? { goal: { ...old.goal, status: 'ACTIVE' }, plan } : old,
      );
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.invoices });
      void queryClient.invalidateQueries({ queryKey: workbenchKeys.runway });
    },
  });
}

export type { CurrentGoalResponse, ListInvoicesResponse, RunwayResponse };

/** True for a failure that came from a policy check, so the UI can show which rule blocked. */
export function isPolicyBlock(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'POLICY_BLOCKED';
}
