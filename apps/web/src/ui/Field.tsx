import clsx from 'clsx';
import { type ComponentPropsWithRef, type ReactNode, useId } from 'react';

const CONTROL =
  'w-full rounded-md border border-rule-strong bg-surface px-2.5 text-base text-ink ' +
  'placeholder:text-ink-3 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 ' +
  'aria-invalid:border-danger';

export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input {...rest} className={clsx(CONTROL, 'h-9', className)} />;
}

export function Textarea({ className, ...rest }: ComponentPropsWithRef<'textarea'>) {
  return <textarea {...rest} className={clsx(CONTROL, 'min-h-20 py-2', className)} />;
}

export function Select({ className, ...rest }: ComponentPropsWithRef<'select'>) {
  return <select {...rest} className={clsx(CONTROL, 'h-9 pr-7', className)} />;
}

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  /** Spread these props onto the control so the label, hint and error are linked to it. */
  children: (control: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
