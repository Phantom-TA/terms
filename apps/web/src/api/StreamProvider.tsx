import { type ServerEventOf, type ServerEventType } from '@terms/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { connectStream, type EventSourceLike, type StreamStatus } from './stream';

type AnyHandler = (event: never) => void;

interface StreamContextValue {
  status: StreamStatus;
  subscribe: (type: ServerEventType, handler: AnyHandler) => () => void;
}

const StreamContext = createContext<StreamContextValue | null>(null);

export interface StreamProviderProps {
  /** Business of the current session. One connection per session; null means no connection. */
  businessId: string | null;
  createSource?: (url: string) => EventSourceLike;
  children: ReactNode;
}

export function StreamProvider({ businessId, createSource, children }: StreamProviderProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>('closed');
  const handlers = useRef(new Map<ServerEventType, Set<AnyHandler>>());

  useEffect(() => {
    if (businessId === null) return;
    const stream = connectStream({
      onEvent: (event) => {
        handlers.current.get(event.type)?.forEach((handler) => {
          (handler as (e: typeof event) => void)(event);
        });
      },
      onStatus: setStatus,
      // Events may have been missed while disconnected, so refetch what's on screen.
      onReconnected: () => void queryClient.invalidateQueries(),
      ...(createSource ? { createSource } : {}),
    });
    return () => {
      stream.close();
    };
  }, [businessId, createSource, queryClient]);

  const value = useMemo<StreamContextValue>(
    () => ({
      status,
      subscribe: (type, handler) => {
        const set = handlers.current.get(type) ?? new Set<AnyHandler>();
        handlers.current.set(type, set);
        set.add(handler);
        return () => {
          set.delete(handler);
        };
      },
    }),
    [status],
  );

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

function useStreamContext(): StreamContextValue {
  const value = useContext(StreamContext);
  if (!value) throw new Error('Stream hooks must be used inside StreamProvider');
  return value;
}

export function useStreamStatus(): StreamStatus {
  return useStreamContext().status;
}

/** Calls `handler` for each validated server event of `type`. The handler need not be memoised. */
export function useServerEvent<T extends ServerEventType>(
  type: T,
  handler: (event: ServerEventOf<T>) => void,
): void {
  const { subscribe } = useStreamContext();
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(
    () =>
      subscribe(type, (event: ServerEventOf<T>) => {
        latest.current(event);
      }),
    [subscribe, type],
  );
}
