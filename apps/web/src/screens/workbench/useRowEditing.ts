import { type Goal, type Plan } from '@terms/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toApiError } from '../../api/errors';
import { useToast } from '../../ui/Toast';
import { isPolicyBlock, useUpdatePlanItem } from './queries';
import { type WorkbenchRow } from './rows';
import { approvalNote, checkRowEdit, type EditContext, type EditField } from './validateEdit';

/**
 * Connects the grid to the server for owner edits: pre-check with the shared policy functions,
 * send the change, and show the plan the server returns. A change is reported as done only after
 * the server confirms it. Edits are sent one at a time, in the order they were made, so a slow
 * response can't overwrite the plan from a newer one.
 */
export function useRowEditing(goal: Goal | null, plan: Plan | null, today: string) {
  const { mutateAsync } = useUpdatePlanItem();
  const { toast } = useToast();
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const queue = useRef<Promise<void>>(Promise.resolve());

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
      const variables = { planId: plan.id, itemId: row.item.id, patch: result.patch };
      setBusy(row.id, true);

      const send = async (): Promise<void> => {
        try {
          const { policyChecks } = await mutateAsync(variables);
          toast({
            tone: 'success',
            title: `${row.clientName} updated`,
            description: approvalNote(policyChecks) ?? 'The server has recalculated the plan.',
          });
        } catch (error) {
          const apiError = toApiError(error);
          const blocked = isPolicyBlock(error)
            ? apiError.policyChecks.find((c) => c.result === 'blocked')?.detail
            : undefined;
          toast({
            tone: 'error',
            title,
            description: blocked ?? apiError.issues[0]?.message ?? apiError.message,
            debugId: apiError.paypalDebugId,
          });
        } finally {
          setBusy(row.id, false);
        }
      };
      queue.current = queue.current.then(send);
    },
    [context, plan, setBusy, toast, mutateAsync],
  );

  return { onEdit, saving };
}
