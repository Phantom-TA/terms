import { type ServerEvent } from '@terms/shared';
import { type EventSourceLike } from '../api/stream';

/** An EventSource a test can push server events through. */
export class FakeEventSource implements EventSourceLike {
  static latest: FakeEventSource | null = null;
  readyState = 1;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  private readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor() {
    FakeEventSource.latest = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.(new Event('open'));
  }
  /** Delivers a server event as the browser would. */
  emit(event: ServerEvent): void {
    this.listeners.get(event.type)?.(
      new MessageEvent(event.type, { data: JSON.stringify(event), lastEventId: event.id }),
    );
  }
}

export const createFakeEventSource = () => new FakeEventSource();
