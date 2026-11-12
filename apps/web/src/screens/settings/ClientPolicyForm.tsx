import { type BusinessRef, type ClientPolicyView, PutClientPolicyRequest } from '@terms/shared';
import { type SyntheticEvent, useState } from 'react';
import { formatDateTime, plainMoney, plainPercent } from '../../lib/display';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Field';
import { useToast } from '../../ui/Toast';
import {
  draftChanged,
  type FieldErrors,
  FormActions,
  issuesToErrors,
  readMoney,
  readPercent,
  SaveError,
} from './formParts';
import { useSaveClientPolicy } from './queries';

type Key = 'hurdle' | 'target' | 'buffer' | 'autoPay' | 'cap';

interface Draft {
  hurdle: string;
  target: string;
  buffer: string;
  autoPay: string;
  hasCap: boolean;
  cap: string;
  neverPayEarly: readonly string[];
}

function draftOf(policy: ClientPolicyView): Draft {
  return {
    hurdle: plainPercent(policy.hurdleRatePct),
    target: plainPercent(policy.targetRatePct),
    buffer: plainMoney(policy.cashBuffer),
    autoPay: plainMoney(policy.autoPayLimit),
    hasCap: policy.earlyPayCapPerDeal !== null,
    cap: plainMoney(policy.earlyPayCapPerDeal ?? ''),
    neverPayEarly: policy.neverPayEarly.map((b) => b.id),
  };
}

const FIELDS: Readonly<Record<string, Key>> = {
  hurdleRatePct: 'hurdle',
  targetRatePct: 'target',
  cashBuffer: 'buffer',
  autoPayLimit: 'autoPay',
  earlyPayCapPerDeal: 'cap',
};

export function clientRequest(draft: Draft): {
  request: PutClientPolicyRequest | null;
  errors: FieldErrors<Key>;
} {
  const errors: FieldErrors<Key> = {};
  const body = {
    hurdleRatePct: readPercent(draft.hurdle, 'hurdle', errors),
    targetRatePct: readPercent(draft.target, 'target', errors),
    cashBuffer: readMoney(draft.buffer, 'buffer', errors),
    autoPayLimit: readMoney(draft.autoPay, 'autoPay', errors),
    earlyPayCapPerDeal: draft.hasCap ? readMoney(draft.cap, 'cap', errors) : null,
    neverPayEarlyIds: [...draft.neverPayEarly],
  };
  const parsed = PutClientPolicyRequest.safeParse(body);
  if (!parsed.success) issuesToErrors(parsed.error.issues, FIELDS, errors);
  return {
    request: parsed.success && Object.keys(errors).length === 0 ? parsed.data : null,
    errors,
  };
}

export interface ClientPolicyFormProps {
  policy: ClientPolicyView;
  /** Suppliers the agent could refuse to pay early. */
  suppliers: readonly BusinessRef[];
}

/** The rules the client's agent follows when an offer comes in. */
export function ClientPolicyForm({ policy, suppliers }: ClientPolicyFormProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(policy));
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const save = useSaveClientPolicy();
  const { toast } = useToast();
  const dirty = draftChanged(draft, draftOf(policy));

  const submit = async (event?: SyntheticEvent) => {
    event?.preventDefault();
    const { request, errors: found } = clientRequest(draft);
    setErrors(found);
    if (!request) return;
    try {
      const saved = await save.mutateAsync(request);
      setDraft(draftOf(saved));
      toast({
        tone: 'success',
        title: 'Policy saved',
        description: 'Your agent uses it for the next offer.',
      });
    } catch {
      // Shown below from the mutation's error.
    }
  };

  const set = <F extends keyof Draft>(field: F, value: Draft[F]) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Hurdle rate (% a year)"
          hint="Accept offers that return at least this."
          error={errors.hurdle ?? null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.hurdle}
              onChange={(e) => {
                set('hurdle', e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Target rate (% a year)"
          hint="Counter at this when an offer falls short."
          error={errors.target ?? null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.target}
              onChange={(e) => {
                set('target', e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Cash buffer ($)"
          hint="Never pay early if cash would fall below this."
          error={errors.buffer ?? null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.buffer}
              onChange={(e) => {
                set('buffer', e.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Auto-pay limit ($)"
          hint="Above this, a person approves in PayPal."
          error={errors.autoPay ?? null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.autoPay}
              onChange={(e) => {
                set('autoPay', e.target.value);
              }}
            />
          )}
        </Field>
        <div className="space-y-1">
          <Field
            label="Early-pay cap per deal ($)"
            hint="Above this, counter with a smaller part."
            error={errors.cap ?? null}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                disabled={!draft.hasCap}
                value={draft.hasCap ? draft.cap : ''}
                onChange={(e) => {
                  set('cap', e.target.value);
                }}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={!draft.hasCap}
              onChange={(e) => {
                set('hasCap', !e.target.checked);
              }}
            />
            No cap
          </label>
        </div>
      </div>

      {suppliers.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-2">Never pay early</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {suppliers.map((supplier) => (
              <label key={supplier.id} className="flex items-center gap-2 text-base">
                <input
                  type="checkbox"
                  checked={draft.neverPayEarly.includes(supplier.id)}
                  onChange={(e) => {
                    set(
                      'neverPayEarly',
                      e.target.checked
                        ? [...draft.neverPayEarly, supplier.id]
                        : draft.neverPayEarly.filter((id) => id !== supplier.id),
                    );
                  }}
                />
                {supplier.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {save.isError ? <SaveError error={save.error} onRetry={() => void submit()} /> : null}

      <FormActions>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty}>
          Save policy
        </Button>
        {dirty ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(draftOf(policy));
              setErrors({});
              save.reset();
            }}
          >
            Discard changes
          </Button>
        ) : (
          <span className="text-sm text-ink-3">Saved {formatDateTime(policy.updatedAt)}</span>
        )}
      </FormActions>
    </form>
  );
}
