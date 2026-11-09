import { act, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { Button } from './Button';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './Toast';

function Harness() {
  const { toast, toastError } = useToast();
  return (
    <div>
      <Button
        onClick={() => {
          toast({ tone: 'success', title: 'Plan approved' });
        }}
      >
        ok
      </Button>
      <Button
        onClick={() => {
          toastError(
            'Could not update the invoice',
            new ApiError({
              kind: 'server',
              message: 'PayPal said no.',
              paypal: { debugId: 'dbg-1', name: null, message: 'x', httpStatus: 500 },
            }),
          );
        }}
      >
        fail
      </Button>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('shows a success toast and removes it after a while', () => {
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    expect(screen.getByRole('status')).toHaveTextContent('Plan approved');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps an error until dismissed and shows the debug ID', () => {
    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 5);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('PayPal said no.');
    expect(screen.getByRole('alert')).toHaveTextContent('dbg-1');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('useToast', () => {
  it('throws outside its provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow('useToast must be used inside ToastProvider');
  });
});
