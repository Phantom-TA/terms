import {
  type CurrentGoalResponse,
  type ListInvoicesResponse,
  type RunwayResponse,
  type ServerEventOf,
} from '@terms/shared';
import { belongsOnWorkbench } from './rows';

/**
 * Pure reducers that fold server-sent events into the cached Workbench data. The server's event is
 * the truth: nothing here computes money or payment state.
 */

export function applyInvoiceUpdated(
  old: ListInvoicesResponse | undefined,
  event: ServerEventOf<'invoice.updated'>,
): ListInvoicesResponse | undefined {
  if (!old) return old;
  const { invoice } = event.data;
  const exists = old.rows.some((row) => row.id === invoice.id);
  if (!exists && !belongsOnWorkbench(invoice)) return old;
  return {
    ...old,
    rows: exists
      ? old.rows.map((row) => (row.id === invoice.id ? invoice : row))
      : [...old.rows, invoice],
  };
}

export function applyDealUpdated(
  old: ListInvoicesResponse | undefined,
  event: ServerEventOf<'deal.updated'>,
): ListInvoicesResponse | undefined {
  if (!old) return old;
  const { deal } = event.data;
  return {
    ...old,
    rows: old.rows.map((row) => {
      if (row.id !== deal.invoiceId) return row;
      return {
        ...row,
        deal,
        planItem:
          row.planItem?.id === deal.planItemId
            ? { ...row.planItem, dealId: deal.id, dealState: deal.state }
            : row.planItem,
      };
    }),
  };
}

export function applyPlanUpdated(
  old: CurrentGoalResponse | undefined,
  event: ServerEventOf<'plan.updated'>,
): CurrentGoalResponse | undefined {
  if (old?.plan?.id !== event.data.planId) return old;
  return {
    ...old,
    plan: { ...old.plan, status: event.data.status, summary: event.data.summary },
  };
}

export function applyRunwayUpdated(
  _old: RunwayResponse | undefined,
  event: ServerEventOf<'runway.updated'>,
): RunwayResponse {
  return event.data.runway;
}
