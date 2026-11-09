import { type Goal, type Plan } from '@terms/shared';
import { useCallback, useMemo, useState } from 'react';
import { toApiError } from '../../api/errors';
import { useToast } from '../../ui/Toast';
import { isPolicyBlock, useUpdatePlanItem } from './queries';
import { type WorkbenchRow } from './rows';
import { approvalNote, checkRowEdit, type EditContext, type EditField } from './validateEdit';

/**
 * Connects the grid to the server for owner edits: pre-check with the shared policy functions,
 * send the change, and show the plan the server returns. A change is reported as done only after
 * the server confirms it.
 */
export function useRowEditing(goal: Goal | null, plan: Plan | null, today: string) {
  const update = useUpdatePlanItem();
  const { toast } = useToast();
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  const context = useMemo<EditContext | null>(() => {
    if (!goal || !plan) return null;
    return {
      maxDiscountPct: goal.maxDiscountPct,
      openingDiscountPct: goal.openingDiscountPct,
      doNotContactIds: goal.doNotContact.flatMap((d) => (d.businessId ? [d.businessId] : [])),
      costCeiling: plan.costCeiling,
      plannedCost: plan.summary.plannedCost,
      today,
    };
  }, [goal, plan, today]);

  const setBusy = useCallback((rowId: string, busy: boolean) => {
    setSaving((current) => {
      const next = new Set(current);
      if (busy) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);

  const onEdit = useCallback(
    (row: WorkbenchRow, field: EditField, raw: string) => {
      if (!context || !plan || !row.item) return;
      const title = `${row.clientName}: not changed`;
      const result = checkRowEdit(row, field, raw, context);
      if (!result.ok) {
        toast({ tone: 'error', title, description: result.message });
        return;
      }
      setBusy(row.id, true);
      update.mutate(
        { planId: plan.id, itemId: row.item.id, patch: result.patch },
        {
          onSuccess: ({ policyChecks }) => {
            toast({
              tone: 'success',
              title: `${row.clientName} updated`,
              description: approvalNote(policyChecks) ?? 'The server has recalculated the plan.',
            });
          },
          onError: (error) => {
            const apiError = toApiError(error);
            const blocked = isPolicyBlock(error)
              ? apiError.policyChecks.find((c) => c.result === 'blocked')?.detail
              : undefined;
            toast({
              tone: 'error',
              title,
              description: blocked ?? apiError.message,
              debugId: apiError.paypalDebugId,
            });
          },
          onSettled: () => {
            setBusy(row.id, false);
          },
        },
      );
    },
    [context, plan, setBusy, toast, update],
  );

  return { onEdit, saving };
}
