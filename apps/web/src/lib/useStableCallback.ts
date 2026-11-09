import { useCallback, useEffect, useRef } from 'react';

/**
 * A function whose identity never changes but which always calls the latest `fn`. For handlers
 * passed into long-lived objects, such as AG Grid column definitions, where a new function on
 * every render would rebuild the columns and lose the grid's state.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
