import { type BusinessRef } from '@terms/shared';
import { lazy, Suspense, useMemo } from 'react';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { SkeletonRows } from '../../ui/Skeleton';
import { GoalBar } from './GoalBar';
import { RunwayPanel } from './RunwayPanel';
import { TopRail } from './TopRail';
import { useCurrentGoal, useInvoices } from './queries';
import { toSummaryRow, toWorkbenchRows } from './rows';
import { useRowEditing } from './useRowEditing';

// AG Grid Enterprise is large, so the goal bar shouldn't wait for it.
const WorkbenchGrid = lazy(() =>
  import('./WorkbenchGrid').then((module) => ({ default: module.WorkbenchGrid })),
);

const GRID_COLUMNS = 8;

export function Component() {
  const goalQuery = useCurrentGoal();
  const invoicesQuery = useInvoices();

  const goal = goalQuery.data?.goal ?? null;
  const plan = goalQuery.data?.plan ?? null;
  const invoices = invoicesQuery.data;

  const rows = useMemo(
    () =>
      invoices
        ? toWorkbenchRows(
            invoices.rows.map((r) => r),
            plan?.status ?? null,
          )
        : [],
    [invoices, plan?.status],
  );
  const summary = useMemo(() => (plan ? toSummaryRow(plan.summary) : null), [plan]);
  const clients = useMemo<BusinessRef[]>(
    () =>
      invoices ? [...new Map(invoices.rows.map((r) => [r.client.id, r.client])).values()] : [],
    [invoices],
  );

  const { onEdit, saving } = useRowEditing(goal, plan, invoices?.today ?? '');

  if (goalQuery.isPending || invoicesQuery.isPending) {
    return (
      <div className="p-4 lg:p-6">
        <h1 className="mb-4 text-xl">Workbench</h1>
        <SkeletonRows rows={6} columns={GRID_COLUMNS} label="Loading the Workbench" />
      </div>
    );
  }

  const failure = goalQuery.error ?? invoicesQuery.error;
  if (failure) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorState
          headingLevel="h1"
          title="Couldn’t load the Workbench"
          error={failure}
          onRetry={() => {
            void goalQuery.refetch();
            void invoicesQuery.refetch();
          }}
          retrying={goalQuery.isFetching || invoicesQuery.isFetching}
        />
      </div>
    );
  }

  return (
    <div>
      <header className="flex items-baseline gap-3 px-4 pt-4 lg:px-6">
        <h1 className="text-xl">Workbench</h1>
        {invoices?.demo ? <span className="text-sm text-ink-3">Demo data</span> : null}
      </header>
      <GoalBar goal={goal} hasPlan={plan !== null} clients={clients} />
      {/* Side by side on wide screens, so the grid starts within the first screenful. */}
      <div
        className={
          plan
            ? 'grid border-b border-rule xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:*:border-b-0 xl:[&>:last-child]:border-l xl:[&>:last-child]:border-rule'
            : 'border-b border-rule *:border-b-0'
        }
      >
        {goal && plan ? <TopRail goal={goal} plan={plan} /> : null}
        <RunwayPanel />
      </div>

      <div className="space-y-3 p-4 lg:p-6">
        {rows.length === 0 ? (
          <EmptyState title="No open invoices">
            Create one in PayPal or run the demo seed.
          </EmptyState>
        ) : (
          <Suspense
            fallback={<SkeletonRows rows={5} columns={GRID_COLUMNS} label="Loading the grid" />}
          >
            <WorkbenchGrid
              rows={rows}
              summary={summary}
              canEdit={plan?.status === 'DRAFT'}
              onEdit={onEdit}
              saving={saving}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
