import { paths } from '@terms/shared';
import { sse } from 'msw';
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** The stream handler lives here because it needs EventSource, which only the browser has. */
const streamHandler = sse<{ heartbeat: string }>(paths.stream(), ({ client }) => {
  const id = `mock-${Date.now().toString()}`;
  client.send({
    id,
    event: 'heartbeat',
    data: JSON.stringify({ id, type: 'heartbeat', at: new Date().toISOString(), data: {} }),
  });
});

export const worker = setupWorker(...handlers, streamHandler);
