import { type Goal, type Plan } from '@terms/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // The latest limits and plan cost, for an edit that waited in the queue behind another.
  const latest = useRef(context);
  useEffect(() => {
    latest.current = context;
  }, [context]);

  // A row can have several edits in flight; it stays marked as saving until the last one is done.
  const inFlight = useRef(new Map<string, number>());
  const setBusy = useCallback((rowId: string, busy: boolean) => {
    const count = (inFlight.current.get(rowId) ?? 0) + (busy ? 1 : -1);
    if (count > 0) inFlight.current.set(rowId, count);
    else inFlight.current.delete(rowId);
    setSaving(new Set(inFlight.current.keys()));
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
      const planId = plan.id;
      const itemId = row.item.id;
      setBusy(row.id, true);

      const send = async (): Promise<void> => {
        try {
          // Checked again against the plan as it is now: an edit sent before this one may have
          // changed the plan's cost. The server checks it too.
          const now = checkRowEdit(row, field, raw, latest.current ?? context);
          if (!now.ok) {
            toast({ tone: 'error', title, description: now.message });
            return;
          }
          const { policyChecks } = await mutateAsync({ planId, itemId, patch: now.patch });
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
