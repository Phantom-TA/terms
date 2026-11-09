import { AlertTriangle, RotateCw } from 'lucide-react';
import { toApiError } from '../api/errors';
import { Button } from './Button';
import { CopyButton } from './CopyButton';
import { PolicyBadge } from './finance';

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  /** Shows a retry button. Omit it when retrying cannot help. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Use "h1" when this error is the only content on the page. */
  headingLevel?: 'h1' | 'h2' | 'h3';
}

/** Shows a real failure: what went wrong, PayPal's debug ID, and which policy checks blocked it. */
export function ErrorState({
  error,
  title = 'That didn’t work',
  onRetry,
  retrying = false,
  headingLevel: Heading = 'h2',
}: ErrorStateProps) {
  const apiError = toApiError(error);
  const debugId = apiError.paypalDebugId;
  const paypalName = apiError.paypal?.name ?? null;

  return (
    <div role="alert" className="rounded-lg border border-danger bg-danger-soft/50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <Heading className="text-md text-danger">{title}</Heading>
            <p className="text-base text-ink">{apiError.message}</p>
            {paypalName ? <p className="text-sm text-ink-2">PayPal said: {paypalName}</p> : null}
            <p className="text-sm text-ink-2">Nothing was marked as done.</p>
          </div>

          {apiError.policyChecks.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Policy checks">
              {apiError.policyChecks.map((check) => (
                <li key={check.rule}>
                  <PolicyBadge check={check} />
                </li>
              ))}
            </ul>
          ) : null}

          {apiError.issues.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-ink-2">
              {apiError.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  {issue.path ? `${issue.path}: ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          {debugId ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              PayPal debug ID
              <code className="rounded-sm bg-surface px-1 font-mono text-xs break-all text-ink">
                {debugId}
              </code>
              <CopyButton value={debugId} label="Copy PayPal debug ID" />
            </p>
          ) : null}

          {apiError.requestId ? (
            <p className="text-xs text-ink-3">
              Request ID <code className="font-mono">{apiError.requestId}</code>
            </p>
          ) : null}

          {onRetry ? (
            <Button
              size="sm"
              onClick={onRetry}
              loading={retrying}
              icon={<RotateCw aria-hidden className="size-3.5" />}
            >
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
