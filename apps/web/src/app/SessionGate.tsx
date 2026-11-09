import { Outlet } from 'react-router-dom';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonRows } from '../ui/Skeleton';
import { useSession } from './session';
import { SessionPicker } from './SessionPicker';

/** Holds back owner and client screens until a demo session exists. */
export function SessionGate() {
  const session = useSession();

  if (session.isPending) {
    return (
      <div className="p-6">
        <SkeletonRows label="Loading your session" />
      </div>
    );
  }
  if (session.isError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <ErrorState
          headingLevel="h1"
          title="Could not load your session"
          error={session.error}
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      </div>
    );
  }
  if (session.data === null) return <SessionPicker />;
  return <Outlet />;
}
