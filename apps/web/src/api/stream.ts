import { paths, SERVER_EVENT_TYPES, ServerEvent } from '@terms/shared';

/** The parts of EventSource this client uses, so tests can supply a fake. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StreamOptions {
  onEvent: (event: ServerEvent) => void;
  onStatus?: (status: StreamStatus) => void;
  /** Called after the connection comes back, so screens can refetch anything they missed. */
  onReconnected?: () => void;
  createSource?: (url: string) => EventSourceLike;
  /** Delay before the first manual reconnect; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}

export interface StreamHandle {
  close: () => void;
}

const CLOSED = 2;
const SEEN_EVENT_LIMIT = 500;

/**
 * The only SSE client. Validates every frame against the shared `ServerEvent` union and drops
 * replayed frames by event ID. EventSource reconnects itself after a dropped connection (resuming
 * with Last-Event-ID); when the server refuses the connection outright this client retries with
 * backoff, because the browser gives up in that case.
 */
export function connectStream(options: StreamOptions): StreamHandle {
  const {
    onEvent,
    onStatus,
    onReconnected,
    createSource = (url) => new EventSource(url, { withCredentials: true }),
    retryMs = 1000,
    maxRetryMs = 30_000,
  } = options;

  const seen = new Set<string>();
  let source: EventSourceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let hasOpened = false;
  let dropped = false;
  let attempts = 0;

  const handleFrame = (frame: MessageEvent<string>): void => {
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      console.error('Dropped an SSE frame that was not JSON');
      return;
    }
    const parsed = ServerEvent.safeParse(payload);
    if (!parsed.success) {
      console.error('Dropped an SSE frame that did not match ServerEvent', parsed.error);
      return;
    }
    if (seen.has(parsed.data.id)) return;
    seen.add(parsed.data.id);
    if (seen.size > SEEN_EVENT_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    onEvent(parsed.data);
  };

  const open = (): void => {
    const current = createSource(paths.stream());
    source = current;
    for (const type of SERVER_EVENT_TYPES) current.addEventListener(type, handleFrame);

    current.onopen = () => {
      attempts = 0;
      onStatus?.('open');
      if (hasOpened && dropped) onReconnected?.();
      hasOpened = true;
      dropped = false;
    };

    current.onerror = () => {
      if (closed) return;
      dropped = true;
      onStatus?.('reconnecting');
      if (current.readyState !== CLOSED) return;
      current.close();
      const delay = Math.min(retryMs * 2 ** attempts, maxRetryMs);
      attempts += 1;
      timer = setTimeout(open, delay);
    };
  };

  onStatus?.('connecting');
  open();

  return {
    close: () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      source?.close();
      onStatus?.('closed');
    },
  };
}
