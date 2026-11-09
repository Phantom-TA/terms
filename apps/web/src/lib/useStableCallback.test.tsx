import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  it('keeps the same function identity across renders', () => {
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: (n: number) => n },
    });
    const first = result.current;
    rerender({ fn: (n: number) => n * 2 });
    expect(result.current).toBe(first);
  });

  it('always calls the latest function', () => {
    const calls: string[] = [];
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: (x: string) => calls.push(`old:${x}`) },
    });
    rerender({ fn: (x: string) => calls.push(`new:${x}`) });
    result.current('a');
    expect(calls).toEqual(['new:a']);
  });

  it('passes arguments through and returns the result', () => {
    const fn = vi.fn((a: number, b: number) => a + b);
    const { result } = renderHook(() => useStableCallback(fn));
    expect(result.current(2, 3)).toBe(5);
    expect(fn).toHaveBeenCalledWith(2, 3);
  });
});
