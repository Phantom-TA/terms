import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../app/router';
import { ToastProvider } from '../ui/Toast';
import { StreamProvider } from '../api/StreamProvider';
import { type EventSourceLike } from '../api/stream';

class SilentSource implements EventSourceLike {
  readyState = 1;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  addEventListener(): void {}
  close(): void {}
}

const createSource = () => new SilentSource();

/** Renders the real routes against MSW, with no retries so failures show immediately. */
export function renderApp(initialPath = '/', businessId: string | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <StreamProvider businessId={businessId} createSource={createSource}>
          <RouterProvider router={router} />
        </StreamProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, queryClient };
}
