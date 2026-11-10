import { Actor, AuditAction } from '@terms/shared';
import { lazy, Suspense, useMemo, useState } from 'react';
import { ACTOR_LABEL, actionLabel } from '../../lib/labels';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Field, Input, Select } from '../../ui/Field';
import { SkeletonRows } from '../../ui/Skeleton';
import { type AuditFilters, useAudit, useAuditLive } from './queries';

const AuditGrid = lazy(() => import('./AuditGrid').then((m) => ({ default: m.AuditGrid })));

/** Every consequential step, newest first: who did it, the checks, PayPal's IDs and webhooks. */
export function Component() {
  const [filters, setFilters] = useState<AuditFilters>({ actor: null, action: null });
  const [search, setSearch] = useState('');
  const query = useAudit(filters);
  useAuditLive(filters);
  const entries = useMemo(() => query.data?.pages.flatMap((p) => p.entries) ?? [], [query.data]);

  return (
    <div className="space-y-4 px-4 py-4 lg:px-6">
      <header>
        <h1 className="text-xl">Audit trail</h1>
        <p className="text-base text-ink-2">
          Every step Terms took or saw, with PayPal’s request and debug IDs and whether each webhook
          passed verification.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Who">
          {(control) => (
            <Select
              {...control}
              className="w-48"
              value={filters.actor ?? ''}
              onChange={(e) => {
                setFilters({
                  ...filters,
                  actor: e.target.value === '' ? null : Actor.parse(e.target.value),
                });
              }}
            >
              <option value="">Everyone</option>
              {Actor.options.map((actor) => (
                <option key={actor} value={actor}>
                  {ACTOR_LABEL[actor]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="What">
          {(control) => (
            <Select
              {...control}
              className="w-56"
              value={filters.action ?? ''}
              onChange={(e) => {
                setFilters({
                  ...filters,
                  action: e.target.value === '' ? null : AuditAction.parse(e.target.value),
                });
              }}
            >
              <option value="">Everything</option>
              {AuditAction.options.map((action) => (
                <option key={action} value={action}>
                  {actionLabel(action)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Search these entries">
          {(control) => (
            <Input
              {...control}
              type="search"
              className="w-64"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          )}
        </Field>
      </div>

      {query.isPending ? (
        <SkeletonRows rows={8} columns={5} label="Loading the audit trail" />
      ) : null}
      {query.isError && !query.data ? (
        <ErrorState
          title="Couldn’t load the audit trail"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : null}
      {query.data && entries.length === 0 ? (
        filters.actor || filters.action ? (
          <EmptyState title="No matching entries">
            Nothing recorded matches these filters. Choose Everyone and Everything to see it all.
          </EmptyState>
        ) : (
          <EmptyState title="Nothing recorded yet">
            Steps appear here as soon as Terms takes them.
          </EmptyState>
        )
      ) : null}
      {entries.length > 0 ? (
        <>
          <Suspense fallback={<SkeletonRows rows={8} columns={5} label="Loading the grid" />}>
            <AuditGrid entries={entries} search={search} />
          </Suspense>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-3">{entries.length} entries shown</span>
            {query.hasNextPage ? (
              <Button
                size="sm"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
              >
                Load older entries
              </Button>
            ) : null}
          </div>
          {query.isFetchNextPageError ? (
            <ErrorState
              title="Couldn’t load older entries"
              error={query.error}
              onRetry={() => void query.fetchNextPage()}
              retrying={query.isFetchingNextPage}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
