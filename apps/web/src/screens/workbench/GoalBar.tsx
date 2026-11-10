import {
  type BusinessRef,
  type Goal,
  normalizeMoneyInput,
  normalizePercentInput,
} from '@terms/shared';
import { type SyntheticEvent, useState } from 'react';
import { toApiError } from '../../api/errors';
import { formatDate, formatPercent, plainMoney, plainPercent } from '../../lib/display';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Chip, EditableChip } from '../../ui/Chip';
import { ErrorState } from '../../ui/ErrorState';
import { Field, Input, Select } from '../../ui/Field';
import { useToast } from '../../ui/Toast';
import {
  displayMoney,
  validateAmount,
  validateDate,
  validateOpening,
  validatePercent,
} from './goalFields';
import { useCreateGoal, useCreatePlan, useUpdateGoal } from './queries';

/** The goal fields the parser filled from the owner's policy, as the chips name them. */
const DEFAULTED_LABEL: Readonly<Record<Goal['defaultedFields'][number], string>> = {
  maxDiscountPct: 'max discount',
  bufferPct: 'buffer',
  deadline: 'date',
  doNotContact: 'who not to contact',
};

const EXAMPLE =
  "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.";

const VERDICT = {
  CONFIRMED: { label: 'Confirmed from PayPal history', tone: 'neutral' },
  QUESTIONED: { label: 'Doesn’t match PayPal history', tone: 'warn' },
  INSUFFICIENT_DATA: { label: 'Not enough history to check', tone: 'warn' },
} as const;

export interface GoalBarProps {
  goal: Goal | null;
  /** True once a plan exists for the goal; the parsed fields are then read-only. */
  hasPlan: boolean;
  /** Clients the owner could add to the do-not-contact list. */
  clients: readonly BusinessRef[];
}

export function GoalBar({ goal, hasPlan, clients }: GoalBarProps) {
  const [text, setText] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const createPlan = useCreatePlan();
  const { toastError } = useToast();

  // A name the server couldn't match protects nobody. Saving the list by client ID drops it, so
  // remember it here and keep warning, rather than let the warning quietly disappear.
  const [unmatched, setUnmatched] = useState<{ goalId: string; names: readonly string[] }>({
    goalId: '',
    names: [],
  });
  const knownUnmatched = unmatched.goalId === goal?.id ? unmatched.names : [];
  const unmatchedNames = [
    ...new Set([
      ...knownUnmatched,
      ...(goal?.doNotContact.filter((d) => d.businessId === null).map((d) => d.name) ?? []),
    ]),
  ];
  if (goal && unmatchedNames.length !== knownUnmatched.length) {
    setUnmatched({ goalId: goal.id, names: unmatchedNames });
  }

  const showForm = goal === null || (goal.status === 'DRAFT' && rewriting);

  // The first try and a retry both close the form once the server has read the goal.
  const read = () => {
    createGoal.mutate(text, {
      onSuccess: () => {
        setRewriting(false);
        setText('');
      },
    });
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (text.trim() === '') return;
    read();
  };

  if (showForm) {
    return (
      <form
        onSubmit={submit}
        className="space-y-2 border-b border-rule bg-surface px-4 py-4 lg:px-6"
      >
        <Field
          label="What cash do you need, and by when?"
          hint="Say it in plain words: the amount, the deadline, the most you'll discount, and anyone not to contact."
        >
          {(control) => (
            <div className="flex flex-wrap gap-2">
              <Input
                {...control}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
                placeholder={EXAMPLE}
                disabled={createGoal.isPending}
                maxLength={500}
                className="h-11 min-w-0 flex-1 text-md"
              />
              <Button
                type="submit"
                variant="primary"
                loading={createGoal.isPending}
                disabled={text.trim() === ''}
                className="h-11"
              >
                Read my goal
              </Button>
              {goal ? (
                <Button
                  variant="ghost"
                  className="h-11"
                  onClick={() => {
                    setRewriting(false);
                  }}
                >
                  Keep the current goal
                </Button>
              ) : null}
            </div>
          )}
        </Field>
        {createGoal.isError ? (
          <ErrorState
            title="Couldn’t read that"
            error={createGoal.error}
            onRetry={read}
            retrying={createGoal.isPending}
          />
        ) : null}
      </form>
    );
  }

  const editable = goal.status === 'DRAFT' && !hasPlan;
  const patch = async (fields: Parameters<typeof updateGoal.mutateAsync>[0]['patch']) => {
    try {
      await updateGoal.mutateAsync({ goalId: goal.id, patch: fields });
    } catch (error) {
      // Re-thrown with the server's words, so the chip shows why it was refused.
      throw new Error(toApiError(error).message, { cause: error });
    }
  };

  const protectedIds = new Set(
    goal.doNotContact.flatMap((d) => (d.businessId ? [d.businessId] : [])),
  );
  const addable = clients.filter((c) => !protectedIds.has(c.id));
  const verdict = goal.forecast ? VERDICT[goal.forecast.verdict] : null;

  const confirm = () => {
    createPlan.mutate(goal.id, {
      onError: (error) => {
        toastError('Couldn’t build the plan', error);
      },
    });
  };

  const chip = (
    label: string,
    display: string,
    editValue: string,
    validate: (raw: string) => string | null,
    commit: (raw: string) => Promise<void>,
  ) =>
    editable ? (
      <EditableChip
        label={label}
        display={display}
        editValue={editValue}
        validate={validate}
        onCommit={commit}
      />
    ) : (
      <Chip label={label}>{display}</Chip>
    );

  return (
    <section
      aria-label="Your goal"
      className="space-y-3 border-b border-rule bg-surface px-4 py-4 lg:px-6"
    >
      <p className="text-md text-ink-2">
        <span className="sr-only">You said: </span>“{goal.rawText}”
      </p>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="What I understood"
      >
        {chip('Amount', displayMoney(goal.amount), plainMoney(goal.amount), validateAmount, (raw) =>
          patch({ amount: normalizeMoneyInput(raw) ?? raw }),
        )}
        {chip('By', formatDate(goal.deadline), goal.deadline, validateDate, (raw) =>
          patch({ deadline: raw }),
        )}
        {chip(
          'Max discount',
          formatPercent(goal.maxDiscountPct),
          plainPercent(goal.maxDiscountPct),
          validatePercent,
          (raw) => patch({ maxDiscountPct: normalizePercentInput(raw) ?? raw }),
        )}
        {chip(
          'Opening',
          formatPercent(goal.openingDiscountPct),
          plainPercent(goal.openingDiscountPct),
          (raw) => validateOpening(raw, goal.maxDiscountPct),
          (raw) => patch({ openingDiscountPct: normalizePercentInput(raw) ?? raw }),
        )}
        {chip(
          'Buffer',
          formatPercent(goal.bufferPct),
          plainPercent(goal.bufferPct),
          validatePercent,
          (raw) => patch({ bufferPct: normalizePercentInput(raw) ?? raw }),
        )}
        <Chip label="Target">{displayMoney(goal.target)}</Chip>
      </div>
      {editable && goal.defaultedFields.length > 0 ? (
        <p className="text-sm text-ink-2">
          Not in your sentence, so taken from your policy:{' '}
          {goal.defaultedFields.map((field) => DEFAULTED_LABEL[field]).join(', ')}. Check before you
          confirm.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Do not contact">
        <span className="text-sm text-ink-3">Do not contact</span>
        {goal.doNotContact.length === 0 ? <span className="text-sm text-ink-2">No one</span> : null}
        {unmatchedNames.map((name) => (
          <Badge key={name} tone="warn">
            No client matched “{name}”. Not protected
          </Badge>
        ))}
        {goal.doNotContact.flatMap((entry) =>
          entry.businessId === null
            ? []
            : [
                <Chip
                  key={entry.businessId}
                  removeDisabled={updateGoal.isPending}
                  {...(editable
                    ? {
                        onRemove: () => {
                          patch({
                            doNotContactIds: [...protectedIds].filter(
                              (id) => id !== entry.businessId,
                            ),
                          }).catch((error: unknown) => {
                            toastError('Couldn’t change the list', error);
                          });
                        },
                        removeLabel: `Allow contact with ${entry.matchedName ?? entry.name}`,
                      }
                    : {})}
                >
                  {entry.matchedName ?? entry.name}
                </Chip>,
              ],
        )}
        {editable && addable.length > 0 ? (
          <Select
            aria-label="Add a client to protect"
            value=""
            disabled={updateGoal.isPending}
            className="h-7 w-44 text-sm"
            onChange={(e) => {
              const id = e.target.value;
              if (id === '') return;
              patch({ doNotContactIds: [...protectedIds, id] }).catch((error: unknown) => {
                toastError('Couldn’t change the list', error);
              });
            }}
          >
            <option value="">Add a client…</option>
            {addable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {goal.forecast && verdict ? (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-rule bg-paper px-3 py-2">
          <Badge tone={verdict.tone}>{verdict.label}</Badge>
          <p className="min-w-0 flex-1 text-base text-ink">{goal.forecast.message}</p>
        </div>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={confirm} loading={createPlan.isPending}>
            Confirm and build plan
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setRewriting(true);
            }}
          >
            Start over
          </Button>
          <span className="text-sm text-ink-3">Nothing is sent until you approve the plan.</span>
        </div>
      ) : null}
    </section>
  );
}
