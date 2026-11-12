import clsx from 'clsx';
import { type ReactNode } from 'react';

export interface CardProps {
  title?: string;
  description?: string;
  /** Controls shown at the top right of the card. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ title, description, actions, className, children }: CardProps) {
  return (
    <section className={clsx('rounded-lg border border-rule bg-surface', className)}>
      {title ? (
        <header className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
          <div>
            <h2 className="text-md">{title}</h2>
            {description ? <p className="text-sm text-ink-3">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
