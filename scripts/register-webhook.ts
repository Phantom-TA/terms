/**
 * Registers the deployed app's PayPal webhook, once.
 *
 *   pnpm webhook:register https://terms.onrender.com
 *
 * Subscribes <url>/api/webhooks/paypal to every INVOICING.*, PAYMENT.CAPTURE.*, CHECKOUT.ORDER.* and
 * VAULT.* event type. Running it again reuses the registration for the same URL instead of creating
 * a second one. Prints the webhook id to set as PAYPAL_WEBHOOK_ID, and lists any other registrations
 * on the app (old tunnels from the spikes) so they can be removed in the PayPal dashboard.
 * Uses the PayPal credentials in the root .env.
 */
import { randomUUID } from 'node:crypto';
import { paths } from '../packages/shared/src/routes.js';
import { z } from 'zod';
import { rest } from './spikes/lib.js';

const WANTED = /^(INVOICING\.|PAYMENT\.CAPTURE\.|CHECKOUT\.ORDER\.|VAULT\.)/;
const Webhook = z.looseObject({ id: z.string(), url: z.string() });

async function main(): Promise<void> {
  const base = process.argv[2];
  if (base === undefined || !/^https:\/\/[^/]+/.test(base)) {
    throw new Error('Usage: pnpm webhook:register https://<your-app-host>  (PayPal needs HTTPS)');
  }
  const url = `${base.replace(/\/$/, '')}${paths.paypalWebhook()}`;

  const existing = await rest.request({
    method: 'GET',
    path: '/v1/notifications/webhooks',
    schema: z.looseObject({ webhooks: z.array(Webhook) }),
  });
  const others = existing.data.webhooks.filter((w) => w.url !== url);
  const same = existing.data.webhooks.find((w) => w.url === url);

  let id: string;
  if (same !== undefined) {
    id = same.id;
    console.log(`Already registered: ${url}`);
  } else {
    const types = await rest.request({
      method: 'GET',
      path: '/v1/notifications/webhooks-event-types',
      schema: z.looseObject({ event_types: z.array(z.looseObject({ name: z.string() })) }),
    });
    const names = types.data.event_types.map((t) => t.name).filter((n) => WANTED.test(n));
    const created = await rest.request({
      method: 'POST',
      path: '/v1/notifications/webhooks',
      requestId: randomUUID(),
      body: { url, event_types: names.map((name) => ({ name })) },
      schema: Webhook,
    });
    id = created.data.id;
    console.log(`Registered ${url} for ${String(names.length)} event types.`);
  }
  console.log(`\nSet this on the server:\n  PAYPAL_WEBHOOK_ID=${id}`);
  if (others.length > 0) {
    console.log('\nOther webhooks on this PayPal app (remove the ones no longer in use):');
    for (const w of others) console.log(`  ${w.id}  ${w.url}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
