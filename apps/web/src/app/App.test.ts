import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { createQueryClient } from './App';

type RetryFn = (failureCount: number, error: Error) => boolean;

const retry = createQueryClient().getDefaultOptions().queries?.retry as RetryFn;

describe('query retry policy', () => {
  const retryable = new ApiError({ kind: 'server', message: 'x', retryable: true });
  const final = new ApiError({ kind: 'server', message: 'x', retryable: false });

  it('retries a retryable failure twice, then stops', () => {
    expect(retry(0, retryable)).toBe(true);
    expect(retry(1, retryable)).toBe(true);
    expect(retry(2, retryable)).toBe(false);
  });

  it('never retries a failure that cannot succeed, such as a policy block', () => {
    expect(retry(0, final)).toBe(false);
  });

  it('never retries an unknown error', () => {
    expect(retry(0, new Error('boom'))).toBe(false);
  });
});
