import { paths, type ServerEvent, type ServerEventType } from '@terms/shared';
import { sse } from 'msw';
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

declare global {
  interface Window {
    /** Mock mode only: pushes a server event into the open event stream, for browser tests. */
    __termsMockEmit?: (event: ServerEvent) => void;
  }
}

const senders = new Set<(event: ServerEvent) => void>();

/** The stream handler lives here because it needs EventSource, which only the browser has. */
const streamHandler = sse<Record<ServerEventType, string>>(paths.stream(), ({ client }) => {
  senders.add((event) => {
    client.send({ id: event.id, event: event.type, data: JSON.stringify(event) });
  });
  const id = `mock-${Date.now().toString()}`;
  client.send({
    id,
    event: 'heartbeat',
    data: JSON.stringify({ id, type: 'heartbeat', at: new Date().toISOString(), data: {} }),
  });
});

window.__termsMockEmit = (event) => {
  for (const send of senders) send(event);
};

export const worker = setupWorker(...handlers, streamHandler);
