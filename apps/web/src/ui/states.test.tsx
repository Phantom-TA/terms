import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { PendingNotice } from './PendingNotice';
import { SkeletonRows } from './Skeleton';

const paypalError = new ApiError({
  kind: 'server',
  status: 502,
  code: 'PAYPAL_ERROR',
  message: 'PayPal rejected the invoice update.',
  retryable: true,
  requestId: 'req_9',
  paypal: {
    debugId: 'f4c1a2b3d5',
    name: 'UNPROCESSABLE_ENTITY',
    message: 'Invalid',
    httpStatus: 422,
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ErrorState', () => {
  it('shows the message, debug ID and that nothing was done', () => {
    render(<ErrorState error={paypalError} />);
    expect(screen.getByRole('alert')).toHaveTextContent('PayPal rejected the invoice update.');
    expect(screen.getByText('f4c1a2b3d5')).toBeInTheDocument();
    expect(screen.getByText('PayPal said: UNPROCESSABLE_ENTITY')).toBeInTheDocument();
    expect(screen.getByText('Nothing was marked as done.')).toBeInTheDocument();
    expect(screen.getByText('req_9')).toBeInTheDocument();
  });

  it('calls retry and shows no retry button without one', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState error={paypalError} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<ErrorState error={paypalError} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says "Copied" only after the clipboard accepts the debug ID', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<ErrorState error={paypalError} />);
    await user.click(screen.getByRole('button', { name: 'Copy PayPal debug ID' }));
    expect(writeText).toHaveBeenCalledWith('f4c1a2b3d5');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('reports a failed copy honestly', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    render(<ErrorState error={paypalError} />);
    await user.click(screen.getByRole('button', { name: 'Copy PayPal debug ID' }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('lists the policy checks that blocked an action', () => {
    render(
      <ErrorState
        error={
          new ApiError({
            kind: 'server',
            code: 'POLICY_BLOCKED',
            message: 'Blocked by policy.',
            policyChecks: [{ rule: 'maxDiscount', result: 'blocked', detail: 'Too high' }],
          })
        }
      />,
    );
    expect(screen.getByRole('list', { name: 'Policy checks' })).toHaveTextContent('Max discount');
  });

  it('handles an error that is not from the API', () => {
    render(<ErrorState error={new Error('boom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ErrorState error={paypalError} onRetry={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('EmptyState', () => {
  it('shows its message and only the action it is given', () => {
    render(
      <EmptyState title="No open invoices">Create one in PayPal or run the demo seed.</EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'No open invoices' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SkeletonRows', () => {
  it('announces loading once and hides the shapes', async () => {
    const { container } = render(<SkeletonRows rows={2} columns={3} label="Loading invoices" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading invoices');
    expect(container.querySelectorAll('[aria-hidden]')).toHaveLength(6);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PendingNotice', () => {
  it('says what it is waiting for', async () => {
    const { container } = render(<PendingNotice detail="Juniper Labs approved in PayPal." />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for PayPal confirmation');
    expect(screen.getByRole('status')).toHaveTextContent('Juniper Labs approved in PayPal.');
    expect(await axe(container)).toHaveNoViolations();
  });
});
