import { lazy, Suspense } from 'react';
import { formatDate } from '../../lib/display';
import { ErrorState } from '../../ui/ErrorState';
import { Skeleton } from '../../ui/Skeleton';
import { useRunway } from './queries';

// AG Charts is large, so the rest of the screen shouldn't wait for it.
const RunwayChart = lazy(() =>
  import('./RunwayChart').then((module) => ({ default: module.RunwayChart })),
);

function ChartSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-2">
      <span className="sr-only">Loading the runway</span>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** Cash runway before and after the plan, from the server. Collapsible, so the grid stays in reach. */
export function RunwayPanel() {
  const runway = useRunway();
  const payroll = runway.data?.thresholds[0];

  return (
    <details open className="group border-b border-rule bg-surface px-4 pt-3 pb-5 lg:px-6">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 rounded-sm py-1 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg">Cash runway</h2>
        <span className="text-sm text-ink-3">
          {payroll
            ? `${payroll.label} lands ${formatDate(payroll.date)}. Show or hide the chart.`
            : 'Show or hide the chart.'}
        </span>
      </summary>
      <div className="pt-2">
        {runway.isPending ? <ChartSkeleton /> : null}
        {runway.isError ? (
          <ErrorState
            title="Couldn’t load the runway"
            error={runway.error}
            onRetry={() => void runway.refetch()}
            retrying={runway.isFetching}
          />
        ) : null}
        {runway.data ? (
          <Suspense fallback={<ChartSkeleton />}>
            <RunwayChart runway={runway.data} />
          </Suspense>
        ) : null}
      </div>
    </details>
  );
}
