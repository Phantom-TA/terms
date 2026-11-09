import { Compass, LayoutGrid } from 'lucide-react';
import { type BusinessRole } from '@terms/shared';
import { Link, Navigate, Outlet, useRouteError } from 'react-router-dom';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonRows } from '../ui/Skeleton';
import { homePathFor } from './screens';
import { useSession } from './session';

const LINK = 'font-medium text-ink underline underline-offset-2';

/** Shown while the first lazy-loaded route arrives. */
export function AppLoading() {
  return (
    <div className="p-6">
      <SkeletonRows label="Loading Terms" />
    </div>
  );
}

/** Sends a business to its first screen. */
export function HomeRedirect() {
  const session = useSession();
  const role = session.data?.business.role;
  const home = role ? homePathFor(role) : null;
  if (home) return <Navigate to={home} replace />;
  if (import.meta.env.DEV) return <Navigate to="/style-guide" replace />;
  return (
    <div className="p-6">
      <EmptyState
        headingLevel="h1"
        icon={<LayoutGrid aria-hidden className="size-6" />}
        title="Nothing here yet"
      >
        There are no screens for this business yet.
      </EmptyState>
    </div>
  );
}

/** Keeps each screen to the businesses it is for, even when opened by its address. */
export function RequireRole({ roles }: { roles: readonly BusinessRole[] }) {
  const session = useSession();
  const business = session.data?.business;
  if (!business || roles.includes(business.role)) return <Outlet />;
  return (
    <div className="p-6">
      <EmptyState
        headingLevel="h1"
        icon={<Compass aria-hidden className="size-6" />}
        title="This screen is for the other side"
      >
        <p>You’re acting as {business.name}. Switch business to open it.</p>
        <Link to="/" className={LINK}>
          Go to your home screen
        </Link>
      </EmptyState>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="p-6">
      <EmptyState
        headingLevel="h1"
        icon={<Compass aria-hidden className="size-6" />}
        title="Page not found"
      >
        <Link to="/" className={LINK}>
          Go to your home screen
        </Link>
      </EmptyState>
    </div>
  );
}

export function RouteError() {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-2xl p-6">
      <ErrorState
        headingLevel="h1"
        title="This screen failed to load"
        error={error}
        onRetry={() => {
          window.location.reload();
        }}
      />
    </div>
  );
}
