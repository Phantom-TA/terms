import { normalizeMoneyInput, normalizePercentInput, type ValidationIssue } from '@terms/shared';
import { type ReactNode } from 'react';
import { toApiError } from '../../api/errors';
import { ErrorState } from '../../ui/ErrorState';

/** "1.20" → "1.2", for an input a person edits. */
export function plainPercent(value: string): string {
  return value.replace(/\.?0+$/, '');
}

export function plainMoney(value: string): string {
  return value.replace(/\.00$/, '');
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Reads a percentage field, recording a message when it isn't one. */
export function readPercent<K extends string>(raw: string, key: K, errors: FieldErrors<K>): string {
  const value = normalizePercentInput(raw);
  if (value === null) errors[key] = 'Enter a percentage like 1.2';
  return value ?? '0.00';
}

export function readMoney<K extends string>(raw: string, key: K, errors: FieldErrors<K>): string {
  const value = normalizeMoneyInput(raw);
  if (value === null) errors[key] = 'Enter an amount like 2000';
  return value ?? '0.00';
}

/** Puts the schema's own messages next to the fields they are about. */
export function issuesToErrors<K extends string>(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
  fields: Readonly<Record<string, K>>,
  errors: FieldErrors<K>,
): void {
  for (const issue of issues) {
    const field = fields[String(issue.path[0] ?? '')];
    if (field && !errors[field]) errors[field] = issue.message;
  }
}

/** A server refusal: its field messages, or the whole error with its debug ID. */
export function SaveError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const apiError = toApiError(error);
  const issues: readonly ValidationIssue[] = apiError.issues;
  return (
    <ErrorState
      title="Not saved"
      error={error}
      {...(issues.length === 0 && apiError.retryable ? { onRetry } : {})}
    />
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-2">{children}</div>;
}
