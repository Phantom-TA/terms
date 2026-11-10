import { paths, type ServerEvent, type ServerEventType } from '@terms/shared';
import { sse } from 'msw';
import { setupWorker } from 'msw/browser';
import { currentDesk, currentWorld, handlers, mockHooks, sessionBusiness } from './handlers';
import { isMockPayment, MOCK_PAYPAL_CHANNEL } from '../screens/dev/mockPayPalChannel';

declare global {
  interface Window {
    /** Mock mode only: pushes a server event into the open event stream, for browser tests. */
    __termsMockEmit?: (event: ServerEvent) => void;
    /** Mock mode only: runs the demo negotiation and streams it. */
    __termsMockNegotiate?: () => void;
  }
}

const senders = new Set<(event: ServerEvent) => void>();

/** The stream handler lives here because it needs EventSource, which only the browser has. */
const streamHandler = sse<Record<ServerEventType, string>>(
  paths.stream(),
  ({ client, request }) => {
    const business = sessionBusiness();
    const sender = (raw: ServerEvent) => {
      // As on the real server, each session hears only its own business's records.
      const event = business ? currentDesk().eventFor(raw, business) : null;
      if (!event) return;
      client.send({ id: event.id, event: event.type, data: JSON.stringify(event) });
    };
    // The app keeps one stream per tab, so a new one (after switching business, say) replaces
    // the old, which can't be written to any more. MSW doesn't always abort the old request.
    senders.clear();
    senders.add(sender);
    // A closed stream (a reconnect, or leaving for PayPal) can't be written to any more.
    request.signal.addEventListener('abort', () => {
      senders.delete(sender);
    });
    const id = `mock-${Date.now().toString()}`;
    client.send({
      id,
      event: 'heartbeat',
      data: JSON.stringify({ id, type: 'heartbeat', at: new Date().toISOString(), data: {} }),
    });
  },
);

window.__termsMockEmit = (event) => {
  for (const send of senders) send(event);
};

/** Browser tests want events at once; a person watching wants to see them arrive. */
const PLAYBACK_MS = navigator.webdriver ? 0 : 900;

function play(events: readonly ServerEvent[]): void {
  events.forEach((event, index) => {
    const send = () => {
      window.__termsMockEmit?.(event);
    };
    if (PLAYBACK_MS === 0) send();
    else setTimeout(send, PLAYBACK_MS * (index + 1));
  });
}

mockHooks.emit = play;
window.__termsMockNegotiate = () => {
  play(currentWorld().startNegotiation());
};
// Someone trying the app by hand sees the negotiation start. Browser tests start it themselves.
if (!navigator.webdriver) {
  mockHooks.onPlanApproved = () => {
    setTimeout(() => {
      play(currentWorld().startNegotiation());
    }, 800);
  };
}

// A payment made on the stand-in PayPal page, in another tab, arrives as PayPal's webhook would.
new BroadcastChannel(MOCK_PAYPAL_CHANNEL).onmessage = (message: MessageEvent<unknown>) => {
  if (!isMockPayment(message.data)) return;
  const world = currentWorld();
  // Only the tab whose demo approved this payment has it waiting; any other tab ignores it.
  if (!world.paymentApproved(message.data.dealId)) return;
  play(world.confirmPayment(message.data.dealId));
};

export const worker = setupWorker(...handlers, streamHandler);
