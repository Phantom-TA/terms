/**
 * GET /api/stream: server-sent events for the session's business. Each event carries its EventLog
 * id, so a browser that reconnects with Last-Event-ID gets what it missed. A heartbeat keeps
 * proxies from closing an idle stream.
 */
import { endpoints, HEARTBEAT_INTERVAL_MS } from '@terms/shared';
import { type Router } from 'express';
import { type Services } from '../../services.js';
import { type Delivery } from '../events.js';
import { route } from '../route.js';

function lastEventId(header: string | string[] | undefined, query: unknown): bigint {
  const raw = typeof header === 'string' ? header : typeof query === 'string' ? query : '';
  return /^\d{1,18}$/.test(raw) ? BigInt(raw) : 0n;
}

export function registerStreamRoute(
  router: Router,
  s: Services,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
): void {
  route(router, s.sessions, endpoints.stream, async ({ req, res, session }) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = ({ seq, event }: Delivery) => {
      res.write(`id: ${seq.toString()}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    // Subscribe first, then replay, so nothing published in between is lost; skip duplicates.
    let replayedUpTo = lastEventId(req.headers['last-event-id'], req.query['lastEventId']);
    const pending: Delivery[] = [];
    let replaying = true;
    const unsubscribe = s.events.subscribe(session.businessId, (d) => {
      if (replaying) pending.push(d);
      else if (d.seq > replayedUpTo) send(d);
    });
    for (const d of await s.events.replay(session.businessId, replayedUpTo)) {
      send(d);
      replayedUpTo = d.seq;
    }
    replaying = false;
    for (const d of pending) if (d.seq > replayedUpTo) send(d);

    const heartbeat = setInterval(() => {
      const beat = {
        id: `hb-${Date.now().toString()}`,
        type: 'heartbeat',
        at: s.now().toISOString(),
        data: {},
      };
      res.write(`event: heartbeat\ndata: ${JSON.stringify(beat)}\n\n`);
    }, heartbeatMs);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return undefined;
  });
}
