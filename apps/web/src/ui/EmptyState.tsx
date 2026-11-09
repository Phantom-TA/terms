import { type ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  /** Only pass an action that works. */
  action?: ReactNode;
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-rule-strong px-6 py-12 text-center">
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <h2 className="text-lg">{title}</h2>
      {children ? <div className="max-w-md text-base text-ink-2">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
