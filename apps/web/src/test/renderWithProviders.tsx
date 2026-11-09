import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { type ReactElement } from 'react';
import { StreamProvider } from '../api/StreamProvider';
import { type EventSourceLike } from '../api/stream';
import { ToastProvider } from '../ui/Toast';

export interface ProviderOptions {
  /** Connects the event stream for this business. Omit for a screen that doesn't need live events. */
  businessId?: string | null;
  createSource?: (url: string) => EventSourceLike;
}

/** For component tests: a fresh query client that never retries, toasts, and an event stream. */
export function renderWithProviders(ui: ReactElement, options: ProviderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <StreamProvider
          businessId={options.businessId ?? null}
          {...(options.createSource ? { createSource: options.createSource } : {})}
        >
          {ui}
        </StreamProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}
