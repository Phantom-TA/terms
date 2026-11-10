/**
 * Live updates (CONTEXT.md: "Live updates reach the screens over server-sent events"). Every event
 * is stored in EventLog per business it is visible to, then pushed to that business's open
 * streams. A reconnecting browser sends Last-Event-ID and receives what it missed.
 */
import { randomUUID } from 'node:crypto';
import { type ServerEvent, type ServerEventType } from '@terms/shared';
import { type Db } from '../db.js';
import { type Prisma } from '../generated/prisma/client.js';

/** An event as published: the bus adds the id and timestamp. */
export type EventInput = {
  [T in ServerEventType]: { type: T; data: Extract<ServerEvent, { type: T }>['data'] };
}[ServerEventType];

export interface Delivery {
  /** EventLog id: the SSE `id:` field and the resume point for Last-Event-ID. */
  seq: bigint;
  event: ServerEvent;
}

type Listener = (delivery: Delivery) => void;

/** How many missed events a reconnecting stream may replay. */
export const REPLAY_LIMIT = 500;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Stores the event for each business, then pushes it to their open streams. */
  async publish(businessIds: readonly string[], input: EventInput): Promise<void> {
    const event = { id: randomUUID(), at: this.now().toISOString(), ...input } as ServerEvent;
    for (const businessId of new Set(businessIds)) {
      const row = await this.db.eventLog.create({
        data: {
          businessId,
          type: event.type,
          // Events are wire objects already (strings, numbers, booleans): stored verbatim.
          payload: JSON.parse(JSON.stringify(event)) as Prisma.InputJsonObject,
        },
      });
      for (const listener of this.listeners.get(businessId) ?? []) {
        listener({ seq: row.id, event });
      }
    }
  }

  /** Subscribes one stream; returns the unsubscribe function. */
  subscribe(businessId: string, listener: Listener): () => void {
    const set = this.listeners.get(businessId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(businessId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(businessId);
    };
  }

  /** Events for a business after `afterSeq`, oldest first. */
  async replay(businessId: string, afterSeq: bigint): Promise<Delivery[]> {
    const rows = await this.db.eventLog.findMany({
      where: { businessId, id: { gt: afterSeq } },
      orderBy: { id: 'asc' },
      take: REPLAY_LIMIT,
    });
    return rows.map((r) => ({ seq: r.id, event: r.payload as unknown as ServerEvent }));
  }

  /** Open streams, for health and tests. */
  streamCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}
