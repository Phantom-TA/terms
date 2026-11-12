import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type EventSourceLike } from './stream';
import { StreamProvider, useServerEvent, useStreamStatus } from './StreamProvider';

class FakeSource implements EventSourceLike {
  static instances: FakeSource[] = [];
  readyState = 0;
  onopen: EventSourceLike['onopen'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor() {
    FakeSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, listener);
  }
  close(): void {
    this.closed = true;
  }
}

const createSource = () => new FakeSource();
const latest = () => FakeSource.instances.at(-1)!;

function Consumer({ onHeartbeat }: { onHeartbeat: (id: string) => void }) {
  const status = useStreamStatus();
  useServerEvent('heartbeat', (event) => {
    onHeartbeat(event.id);
  });
  return <p>status: {status}</p>;
}

function Providers({
  businessId,
  client,
  children,
}: {
  businessId: string | null;
  client: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={client}>
      <StreamProvider businessId={businessId} createSource={createSource}>
        {children}
      </StreamProvider>
    </QueryClientProvider>
  );
}

const heartbeat = JSON.stringify({
  id: 'e1',
  type: 'heartbeat',
  at: '2026-11-09T10:00:00Z',
  data: {},
});

beforeEach(() => {
  FakeSource.instances = [];
});

describe('StreamProvider', () => {
  it('does not connect without a session', () => {
    render(
      <Providers businessId={null} client={new QueryClient()}>
        <Consumer onHeartbeat={() => {}} />
      </Providers>,
    );
    expect(FakeSource.instances).toHaveLength(0);
    expect(screen.getByText('status: closed')).toBeInTheDocument();
  });

  it('delivers typed events and reports status', () => {
    const onHeartbeat = vi.fn();
    render(
      <Providers businessId="biz_1" client={new QueryClient()}>
        <Consumer onHeartbeat={onHeartbeat} />
      </Providers>,
    );
    act(() => {
      latest().onopen?.(new Event('open'));
    });
    expect(screen.getByText('status: open')).toBeInTheDocument();
    act(() => {
      latest().listeners.get('heartbeat')?.(new MessageEvent('heartbeat', { data: heartbeat }));
    });
    expect(onHeartbeat).toHaveBeenCalledWith('e1');
  });

  it('does not re-render or resubscribe event listeners when only the status changes', () => {
    const onRender = vi.fn();
    const onHeartbeat = vi.fn();
    function Listener() {
      onRender();
      useServerEvent('heartbeat', (event) => {
        onHeartbeat(event.id);
      });
      return null;
    }
    render(
      <Providers businessId="biz_1" client={new QueryClient()}>
        <Listener />
      </Providers>,
    );
    const before = onRender.mock.calls.length;
    act(() => {
      latest().onopen?.(new Event('open'));
    });
    act(() => {
      latest().onerror?.(new Event('error'));
    });
    expect(onRender).toHaveBeenCalledTimes(before);
    act(() => {
      latest().listeners.get('heartbeat')?.(new MessageEvent('heartbeat', { data: heartbeat }));
    });
    expect(onHeartbeat).toHaveBeenCalledWith('e1');
  });

  it('opens a new connection when the session changes', () => {
    const client = new QueryClient();
    const { rerender } = render(
      <Providers businessId="biz_1" client={client}>
        <Consumer onHeartbeat={() => {}} />
      </Providers>,
    );
    const first = latest();
    rerender(
      <Providers businessId="biz_2" client={client}>
        <Consumer onHeartbeat={() => {}} />
      </Providers>,
    );
    expect(first.closed).toBe(true);
    expect(FakeSource.instances).toHaveLength(2);
  });

  it('refetches queries after the connection comes back', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
    render(
      <Providers businessId="biz_1" client={client}>
        <Consumer onHeartbeat={() => {}} />
      </Providers>,
    );
    const source = latest();
    act(() => {
      source.onopen?.(new Event('open'));
      source.onerror?.(new Event('error'));
    });
    expect(screen.getByText('status: reconnecting')).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
    act(() => {
      source.onopen?.(new Event('open'));
    });
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
