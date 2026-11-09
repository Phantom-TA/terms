import clsx from 'clsx';
import { Loader2, Pencil, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react';

const SHELL =
  'inline-flex h-7 items-center gap-1.5 rounded-sm border border-rule-strong bg-surface px-2 text-sm';

export interface ChipProps {
  label?: string;
  children: ReactNode;
  /** Shows a remove button. Omit it and the chip cannot be removed. */
  onRemove?: () => void;
  removeLabel?: string;
  /** Blocks removing while an earlier change is still being saved. */
  removeDisabled?: boolean;
  className?: string;
}

export function Chip({
  label,
  children,
  onRemove,
  removeLabel,
  removeDisabled = false,
  className,
}: ChipProps) {
  return (
    <span className={clsx(SHELL, className)}>
      {label ? <span className="text-ink-3">{label}</span> : null}
      <span className="figures font-medium text-ink">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={removeLabel ?? 'Remove'}
          className="-mr-0.5 rounded-sm p-0.5 text-ink-3 hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X aria-hidden className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

export interface EditableChipProps {
  label: string;
  /** The value shown when not editing, e.g. "$6,200.00". */
  display: string;
  /** The text the input starts with when editing, e.g. "6200". */
  editValue: string;
  /** Returns an error message, or null when the value is acceptable. */
  validate?: (raw: string) => string | null;
  /** Called with a valid changed value. Reject to keep the editor open and show the error. */
  onCommit: (raw: string) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

/**
 * A value the owner can correct in place. Enter or leaving the field saves it, Escape cancels.
 * An invalid value keeps the editor open. It closes only after `onCommit` succeeds, so the chip
 * never shows a value the server didn't accept.
 */
export function EditableChip({
  label,
  display,
  editValue,
  validate,
  onCommit,
  disabled = false,
  className,
}: EditableChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const startEditing = () => {
    cancelled.current = false;
    setDraft(editValue);
    setError(null);
    setEditing(true);
  };

  const commit = async () => {
    if (cancelled.current || saving) return;
    const raw = draft.trim();
    if (raw === editValue) {
      setEditing(false);
      return;
    }
    const problem = validate?.(raw) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onCommit(raw);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      cancelled.current = true;
      setEditing(false);
      setError(null);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={startEditing}
        aria-label={`Edit ${label}: ${display}`}
        className={clsx(
          SHELL,
          'group hover:border-ink-3 hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
      >
        <span className="text-ink-3">{label}</span>
        <span className="figures font-medium text-ink">{display}</span>
        {disabled ? null : (
          <Pencil aria-hidden className="size-3 text-ink-3 group-hover:text-ink" />
        )}
      </button>
    );
  }

  return (
    <span className={clsx('inline-flex flex-col gap-1', className)}>
      <span className={clsx(SHELL, 'border-focus')}>
        <label htmlFor={inputId} className="text-ink-3">
          {label}
        </label>
        <input
          id={inputId}
          // Focus moves here because the owner just pressed this chip to edit it.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="figures w-24 bg-transparent font-medium text-ink outline-none"
        />
        {saving ? <Loader2 aria-hidden className="size-3 animate-spin text-ink-3" /> : null}
      </span>
      {error ? (
        <span id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
