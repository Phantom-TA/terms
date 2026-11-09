import { type ServerEvent } from '@terms/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectStream, type EventSourceLike, type StreamStatus } from './stream';

class FakeSource implements EventSourceLike {
  static instances: FakeSource[] = [];
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(readonly url: string) {
    FakeSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fail(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
  emit(type: string, data: string): void {
    this.listeners.get(type)?.(new MessageEvent(type, { data }));
  }
}

function heartbeat(id: string): string {
  return JSON.stringify({ id, type: 'heartbeat', at: '2026-11-09T10:00:00Z', data: {} });
}

function setup() {
  const events: ServerEvent[] = [];
  const statuses: StreamStatus[] = [];
  const onReconnected = vi.fn();
  const handle = connectStream({
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onReconnected,
    createSource: (url) => new FakeSource(url),
    retryMs: 100,
    maxRetryMs: 300,
  });
  return { events, statuses, onReconnected, handle };
}

const latest = () => FakeSource.instances.at(-1)!;

beforeEach(() => {
  FakeSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectStream', () => {
  it('connects to the stream route and reports status', () => {
    const { statuses } = setup();
    expect(latest().url).toBe('/api/stream');
    latest().open();
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('delivers frames that match the contract', () => {
    const { events } = setup();
    latest().emit('heartbeat', heartbeat('e1'));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('heartbeat');
  });

  it('drops malformed and off-contract frames', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { events } = setup();
    latest().emit('heartbeat', 'not json');
    latest().emit('invoice.updated', JSON.stringify({ id: 'x', type: 'invoice.updated' }));
    expect(events).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('ignores a replayed event ID', () => {
    const { events } = setup();
    latest().emit('heartbeat', heartbeat('e1'));
    latest().emit('heartbeat', heartbeat('e1'));
    expect(events).toHaveLength(1);
  });

  it('leaves automatic reconnection to the browser and asks screens to refetch', () => {
    const { statuses, onReconnected } = setup();
    latest().open();
    latest().fail(0);
    expect(statuses.at(-1)).toBe('reconnecting');
    expect(FakeSource.instances).toHaveLength(1);
    latest().open();
    expect(statuses.at(-1)).toBe('open');
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it('retries with backoff when the server refuses the connection', () => {
    const { onReconnected } = setup();
    latest().open();
    latest().fail(2);
    vi.advanceTimersByTime(99);
    expect(FakeSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSource.instances).toHaveLength(2);
    latest().fail(2);
    vi.advanceTimersByTime(199);
    expect(FakeSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSource.instances).toHaveLength(3);
    latest().fail(2);
    vi.advanceTimersByTime(300);
    expect(FakeSource.instances).toHaveLength(4);
    latest().open();
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it('stops everything on close', () => {
    const { handle, statuses } = setup();
    const first = latest();
    first.open();
    first.fail(2);
    handle.close();
    vi.advanceTimersByTime(10_000);
    expect(FakeSource.instances).toHaveLength(1);
    expect(first.closed).toBe(true);
    expect(statuses.at(-1)).toBe('closed');
  });
});
