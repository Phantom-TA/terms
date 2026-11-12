import { type Plan, formatMoney, normalizeMoneyInput, toCents } from '@terms/shared';
import { useState } from 'react';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { ErrorState } from '../../ui/ErrorState';
import { Field, Input } from '../../ui/Field';
import { isOfferAction } from './validateEdit';
import { useApprovePlan } from './queries';
import { useToast } from '../../ui/Toast';

export interface ApprovePlanDialogProps {
  plan: Plan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** What approving will send, in words the owner can check before anything leaves. */
export function describePlan(plan: Plan): { offers: number; reminders: number; backups: number } {
  const primary = plan.items.filter((item) => item.rank === 'PRIMARY');
  return {
    backups: plan.items.filter((item) => item.rank === 'BACKUP').length,
    offers: primary.filter((item) => isOfferAction(item.action)).length,
    reminders: primary.filter((item) => item.action === 'REMINDER').length,
  };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The owner's approval. Nothing is sent before this, and the cost ceiling set here is what the
 * agent may spend without coming back. The plan counts as approved only after the server says so.
 */
export function ApprovePlanDialog({ plan, open, onOpenChange }: ApprovePlanDialogProps) {
  const approve = useApprovePlan();
  const { toast } = useToast();
  const [raw, setRaw] = useState(plan.costCeiling);
  const { offers, reminders, backups } = describePlan(plan);

  const ceiling = normalizeMoneyInput(raw);
  const ceilingError =
    ceiling === null
      ? 'Enter an amount like 60'
      : toCents(ceiling) <= 0n
        ? 'The ceiling must be more than zero'
        : null;
  const overCeiling =
    ceiling !== null && toCents(plan.summary.plannedCost) > toCents(ceiling)
      ? `This plan costs ${formatMoney(plan.summary.plannedCost)} if every offer is accepted, which is above this ceiling.`
      : null;
  const nothingToSend = offers + reminders === 0;

  const close = () => {
    approve.reset();
    onOpenChange(false);
  };

  const submit = async () => {
    if (ceiling === null || ceilingError !== null) return;
    try {
      // Awaited rather than a mutate callback: approving unmounts this dialog, and a callback
      // would be dropped with it, so the owner would never be told.
      await approve.mutateAsync({ planId: plan.id, costCeiling: ceiling });
    } catch {
      return; // Shown in the dialog from the mutation's error.
    }
    onOpenChange(false);
    toast({
      tone: 'success',
      title: 'Plan approved',
      description: 'The plan is locked. Each action shows its state in the grid as it goes out.',
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      title="Approve this plan?"
      description="Nothing is sent until you approve. After that the plan can't be edited."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={approve.isPending}
            disabled={ceilingError !== null || nothingToSend}
          >
            Approve plan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-1 text-base text-ink">
          <li>
            Send <strong>{plural(offers, 'offer')}</strong> worth{' '}
            <strong>{formatMoney(plan.summary.plannedCommitted)}</strong> to clients, if all are
            accepted.
          </li>
          <li>
            Send <strong>{plural(reminders, 'reminder')}</strong>, free and best effort, never
            counted.
          </li>
          <li>
            Total discount cost if every offer is accepted:{' '}
            <strong>{formatMoney(plan.summary.plannedCost)}</strong>.
          </li>
          {backups > 0 ? (
            <li>
              If an offer is declined, <strong>{plural(backups, 'backup')}</strong> can go out
              automatically while the total stays under your ceiling.
            </li>
          ) : null}
          <li>Protected clients are never contacted.</li>
        </ul>

        <Field
          label="Cost ceiling"
          hint="The most this plan may cost. A counter that would go over it comes back to you."
          error={ceilingError}
        >
          {(control) => (
            <Input
              {...control}
              value={raw}
              inputMode="decimal"
              onChange={(event) => {
                setRaw(event.target.value);
                approve.reset();
              }}
            />
          )}
        </Field>

        {overCeiling ? <p className="text-sm text-warn">{overCeiling}</p> : null}
        {plan.summary.shortfall ? (
          <p className="text-sm text-warn">
            Within your limits this plan can't reach your target, so the goal may not be met.
          </p>
        ) : null}
        {nothingToSend ? (
          <p className="text-sm text-ink-2">There is nothing in this plan to send.</p>
        ) : null}

        {approve.isError ? (
          <ErrorState
            title="The plan was not approved"
            error={approve.error}
            onRetry={() => void submit()}
            retrying={approve.isPending}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
