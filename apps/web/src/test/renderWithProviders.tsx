import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { type ReactElement } from 'react';
import { ToastProvider } from '../ui/Toast';

/** For component tests: a fresh query client that never retries, plus toasts. */
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}
