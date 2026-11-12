import { type ReactNode } from 'react';

export interface PendingNoticeProps {
  title?: string;
  detail?: string;
  /** Something the person can do meanwhile, such as a link to PayPal. */
  children?: ReactNode;
}

/** The state between a client approving and the verified webhook arriving. Never shown as done. */
export function PendingNotice({
  title = 'Waiting for PayPal confirmation',
  detail,
  children,
}: PendingNoticeProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-md border border-rule-strong bg-surface px-3 py-2"
    >
      <span aria-hidden className="mt-1.5 size-2 animate-pulse-soft rounded-full bg-info" />
      <div>
        <p className="text-base font-medium text-ink">{title}</p>
        {detail ? <p className="text-sm text-ink-2">{detail}</p> : null}
        {children}
      </div>
    </div>
  );
}
