import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { ApiError } from '../api/errors';
import { StreamProvider } from '../api/StreamProvider';
import { ToastProvider } from '../ui/Toast';
import { createAppRouter } from './router';
import { useSession } from './session';

const MAX_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Only retry what can succeed on retry; a policy block or a 404 won't.
        retry: (failureCount, error) =>
          failureCount < MAX_RETRIES && error instanceof ApiError && error.retryable,
        // Live updates arrive over SSE, so refetching on focus would only cause flicker.
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** One SSE connection per session, reconnected when the session changes. */
export function SessionStream({ children }: { children: ReactNode }) {
  const session = useSession();
  return <StreamProvider businessId={session.data?.business.id ?? null}>{children}</StreamProvider>;
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionStream>
          <RouterProvider router={router} />
        </SessionStream>
      </ToastProvider>
    </QueryClientProvider>
  );
}
