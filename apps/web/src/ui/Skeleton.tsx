import clsx from 'clsx';
import { type ReactNode } from 'react';

const SHIMMER =
  'animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--color-sunken)_25%,var(--color-rule)_50%,var(--color-sunken)_75%)] bg-[length:200%_100%]';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx(SHIMMER, 'h-4', className)} />;
}

/** Announces "loading" once to screen readers and hides the placeholder shapes from them. */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

const WIDTHS = ['w-4/5', 'w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3'];

export function SkeletonRows({
  rows = 6,
  columns = 6,
  label = 'Loading',
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="divide-y divide-rule rounded-lg border border-rule bg-surface">
        {Array.from({ length: rows }, (_row, rowIndex) => (
          <div
            key={rowIndex}
            className="grid items-center gap-4 px-4 py-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }, (_col, colIndex) => (
              <Skeleton
                key={colIndex}
                className={WIDTHS[(rowIndex + colIndex) % WIDTHS.length] ?? 'w-1/2'}
              />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}
