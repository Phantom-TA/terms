import {
  type BusinessRef,
  bpsToPercent,
  defaultOpeningBps,
  normalizePercentInput,
  percentToBps,
  PutSupplierPolicyRequest,
  type SupplierPolicyView,
  Tone,
} from '@terms/shared';
import { type SyntheticEvent, useState } from 'react';
import { formatDateTime, plainMoney, plainPercent } from '../../lib/display';
import { TONE_LABEL } from '../../lib/labels';
import { Button } from '../../ui/Button';
import { Field, Input, Select } from '../../ui/Field';
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
import { useSaveSupplierPolicy } from './queries';

type Key = 'maxDiscount' | 'opening' | 'buffer' | 'ceiling';

interface Draft {
  maxDiscount: string;
  useDefaultOpening: boolean;
  opening: string;
  buffer: string;
  ceiling: string;
  tone: Tone;
  doNotContact: readonly string[];
}

function draftOf(policy: SupplierPolicyView): Draft {
  return {
    maxDiscount: plainPercent(policy.maxDiscountPct),
    useDefaultOpening: policy.openingDiscountPct === null,
    opening: plainPercent(policy.openingDiscountPct ?? ''),
    buffer: plainPercent(policy.bufferPct),
    ceiling: plainMoney(policy.costCeiling),
    tone: policy.tone,
    doNotContact: policy.doNotContact.map((b) => b.id),
  };
}

const FIELDS: Readonly<Record<string, Key>> = {
  maxDiscountPct: 'maxDiscount',
  openingDiscountPct: 'opening',
  bufferPct: 'buffer',
  costCeiling: 'ceiling',
};

export function supplierRequest(draft: Draft): {
  request: PutSupplierPolicyRequest | null;
  errors: FieldErrors<Key>;
} {
  const errors: FieldErrors<Key> = {};
  const body = {
    maxDiscountPct: readPercent(draft.maxDiscount, 'maxDiscount', errors),
    openingDiscountPct: draft.useDefaultOpening
      ? null
      : readPercent(draft.opening, 'opening', errors),
    doNotContactIds: [...draft.doNotContact],
    bufferPct: readPercent(draft.buffer, 'buffer', errors),
    costCeiling: readMoney(draft.ceiling, 'ceiling', errors),
    tone: draft.tone,
  };
  const parsed = PutSupplierPolicyRequest.safeParse(body);
  if (!parsed.success) issuesToErrors(parsed.error.issues, FIELDS, errors);
  return {
    request: parsed.success && Object.keys(errors).length === 0 ? parsed.data : null,
    errors,
  };
}

export interface SupplierPolicyFormProps {
  policy: SupplierPolicyView;
  /** Every client, to choose who is never contacted. */
  clients: readonly BusinessRef[];
}

/** The owner's standing policy. A goal can tighten it for one goal. */
export function SupplierPolicyForm({ policy, clients }: SupplierPolicyFormProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(policy));
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const save = useSaveSupplierPolicy();
  const { toast } = useToast();
  const dirty = draftChanged(draft, draftOf(policy));
  const maxBps = normalizePercentInput(draft.maxDiscount);
  const defaultOpening = maxBps
    ? plainPercent(bpsToPercent(defaultOpeningBps(percentToBps(maxBps))))
    : null;

  const submit = async (event?: SyntheticEvent) => {
    event?.preventDefault();
    const { request, errors: found } = supplierRequest(draft);
    setErrors(found);
    if (!request) return;
    try {
      const saved = await save.mutateAsync(request);
      setDraft(draftOf(saved));
      toast({
        tone: 'success',
        title: 'Policy saved',
        description: 'New plans use it from now on.',
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
          label="Maximum discount (%)"
          hint="Never offered or accepted above this."
          error={errors.maxDiscount ?? null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.maxDiscount}
              onChange={(e) => {
                set('maxDiscount', e.target.value);
              }}
            />
          )}
        </Field>
        <div className="space-y-1">
          <Field
            label="Opening discount (%)"
            hint={
              draft.useDefaultOpening && defaultOpening
                ? `Two-thirds of the maximum: ${defaultOpening}%`
                : 'Where offers start.'
            }
            error={errors.opening ?? null}
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                disabled={draft.useDefaultOpening}
                value={draft.useDefaultOpening ? (defaultOpening ?? '') : draft.opening}
                onChange={(e) => {
                  set('opening', e.target.value);
                }}
              />
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={draft.useDefaultOpening}
              onChange={(e) => {
                set('useDefaultOpening', e.target.checked);
              }}
            />
            Use two-thirds of the maximum
          </label>
        </div>
        <Field
          label="Buffer above the target (%)"
          hint="How much more than the gap to secure."
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
          label="Plan cost ceiling ($)"
          hint="Anything over this comes back to you."
          error={errors.ceiling ?? null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.ceiling}
              onChange={(e) => {
                set('ceiling', e.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Tone of messages" hint="Only how drafts are worded, never the terms.">
          {(control) => (
            <Select
              {...control}
              value={draft.tone}
              onChange={(e) => {
                set('tone', Tone.parse(e.target.value));
              }}
            >
              {Tone.options.map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABEL[tone]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink-2">Never contact</legend>
        <p className="text-sm text-ink-3">Terms will not message these clients, for any goal.</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {clients.map((client) => (
            <label key={client.id} className="flex items-center gap-2 text-base">
              <input
                type="checkbox"
                checked={draft.doNotContact.includes(client.id)}
                onChange={(e) => {
                  set(
                    'doNotContact',
                    e.target.checked
                      ? [...draft.doNotContact, client.id]
                      : draft.doNotContact.filter((id) => id !== client.id),
                  );
                }}
              />
              {client.name}
            </label>
          ))}
        </div>
      </fieldset>

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
