/**
 * Spike S3 control script.
 *
 *   pnpm spike ../../scripts/spikes/s3-webhooks.ts register <publicBaseUrl>
 *     Lists the sandbox's webhook event types and registers <publicBaseUrl>/api/webhooks/paypal for
 *     every INVOICING.*, PAYMENT.CAPTURE.*, CHECKOUT.ORDER.* and VAULT.* type. Saves the webhook id.
 *   pnpm spike ../../scripts/spikes/s3-webhooks.ts trigger
 *     Causes events: a $1.00 vault-funded order from Harbor & Co to Maya (capture), and a full
 *     update of Juniper's spike S1 invoice (invoice update).
 *   pnpm spike ../../scripts/spikes/s3-webhooks.ts simulate <EVENT_TYPE>
 *     Asks PayPal's webhook simulator for a sample event (its signature does not verify by design).
 *   pnpm spike ../../scripts/spikes/s3-webhooks.ts resend <eventId>
 *     Asks PayPal to deliver an event again (same event id), to exercise duplicate handling.
 *   pnpm spike ../../scripts/spikes/s3-webhooks.ts partial
 *     Records a $100.00 external payment on Juniper's spike S1 invoice, to see which event marks
 *     an invoice PARTIALLY_PAID (there is no PARTIALLY_PAID event type).
 *   pnpm spike ../../scripts/spikes/s3-webhooks.ts remove
 *     Deletes the spike's webhook registration.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { rest, save, sdk, step } from './lib.js';

const statePath = new URL('./out/s3-webhook.json', import.meta.url);
const WANTED = /^(INVOICING\.|PAYMENT\.CAPTURE\.|CHECKOUT\.ORDER\.|VAULT\.)/;

function state(): { id: string; url: string } {
  return JSON.parse(readFileSync(statePath, 'utf8')) as { id: string; url: string };
}

async function register(base: string): Promise<void> {
  const types = await step('list webhook event types', () =>
    rest.request({
      method: 'GET',
      path: '/v1/notifications/webhooks-event-types',
      schema: z.looseObject({ event_types: z.array(z.looseObject({ name: z.string() })) }),
    }),
  );
  const names = types.data.event_types.map((t) => t.name).filter((n) => WANTED.test(n));
  console.log(`Subscribing to ${String(names.length)} event types:\n  ${names.join('\n  ')}`);
  const url = `${base.replace(/\/$/, '')}/api/webhooks/paypal`;
  const created = await step(`register ${url}`, () =>
    rest.request({
      method: 'POST',
      path: '/v1/notifications/webhooks',
      requestId: randomUUID(),
      body: { url, event_types: names.map((name) => ({ name })) },
      schema: z.looseObject({ id: z.string(), url: z.string() }),
    }),
  );
  save('s3-webhook', { id: created.data.id, url, eventTypes: names });
  console.log(`Webhook ${created.data.id}`);
}

async function trigger(): Promise<void> {
  const vault = JSON.parse(
    readFileSync(new URL('./out/s5-vault-state.json', import.meta.url), 'utf8'),
  ) as { paymentTokenId?: string };
  const vaultId = vault.paymentTokenId;
  if (vaultId === undefined) throw new Error('Run spike S5 first');
  const order = await step('orders.createOrder $1.00 with vault_id', () =>
    sdk.orders.createOrder({
      payPalRequestId: randomUUID(),
      prefer: 'return=representation',
      body: {
        intent: 'CAPTURE',
        purchaseUnits: [
          {
            amount: { currencyCode: 'USD', value: '1.00' },
            customId: 'spike-s3',
            invoiceId: `S3-${Date.now().toString(36)}`,
          },
        ],
        paymentSource: { paypal: { vaultId } },
      },
    }),
  );
  console.log(
    `Order ${order.id ?? '?'} ${order.status ?? '?'} capture ${order.purchaseUnits?.[0]?.payments?.captures?.[0]?.id ?? '?'}`,
  );

  const s1 = JSON.parse(
    readFileSync(new URL('./out/s1-invoice-update.json', import.meta.url), 'utf8'),
  ) as { result: { juniper: { after: { id: string } } } };
  const invoiceId = s1.result.juniper.after.id;
  const raw = (
    await rest.request({
      method: 'GET',
      path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
      schema: z.looseObject({ detail: z.looseObject({}) }),
    })
  ).data;
  await step(`full update of ${invoiceId} (note only)`, () =>
    rest.request({
      method: 'PUT',
      path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
      query: { send_to_recipient: false, send_to_invoicer: false },
      requestId: randomUUID(),
      body: {
        ...raw,
        // Discounts read back negative (S1); restate the agreed one positively.
        amount: {
          ...(raw['amount'] as Record<string, unknown>),
          breakdown: {
            ...((raw['amount'] as { breakdown?: Record<string, unknown> }).breakdown ?? {}),
            discount: {
              invoice_discount: { amount: { currency_code: 'USD', value: '40.00' } },
            },
          },
        },
        detail: { ...raw.detail, note: `Terms spike S3 update ${new Date().toISOString()}` },
      },
      schema: z.unknown(),
    }),
  );
}

async function simulate(eventType: string): Promise<void> {
  const { id } = state();
  await step(`simulate ${eventType}`, () =>
    rest.request({
      method: 'POST',
      path: '/v1/notifications/simulate-event',
      body: { webhook_id: id, event_type: eventType, resource_version: '2.0' },
      schema: z.unknown(),
    }),
  );
}

async function resend(eventId: string): Promise<void> {
  const { id } = state();
  await step(`resend ${eventId}`, () =>
    rest.request({
      method: 'POST',
      path: `/v1/notifications/webhooks-events/${encodeURIComponent(eventId)}/resend`,
      requestId: randomUUID(),
      body: { webhook_ids: [id] },
      schema: z.unknown(),
    }),
  );
}

async function partial(): Promise<void> {
  const s1 = JSON.parse(
    readFileSync(new URL('./out/s1-invoice-update.json', import.meta.url), 'utf8'),
  ) as { result: { juniper: { after: { id: string } } } };
  const invoiceId = s1.result.juniper.after.id;
  await step(`record external $100.00 on ${invoiceId}`, () =>
    rest.request({
      method: 'POST',
      path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`,
      requestId: randomUUID(),
      body: {
        method: 'OTHER',
        payment_date: new Date().toISOString().slice(0, 10),
        amount: { currency_code: 'USD', value: '100.00' },
        note: 'Terms spike S3: external partial payment',
      },
      schema: z.unknown(),
    }),
  );
  const after = await rest.request({
    method: 'GET',
    path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    schema: z.looseObject({ status: z.string() }),
  });
  console.log(`Invoice status now ${after.data.status}`);
}

async function remove(): Promise<void> {
  const { id } = state();
  await step(`delete webhook ${id}`, () =>
    rest.request({
      method: 'DELETE',
      path: `/v1/notifications/webhooks/${encodeURIComponent(id)}`,
      schema: z.unknown(),
    }),
  );
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'register' && arg !== undefined) await register(arg);
else if (mode === 'trigger') await trigger();
else if (mode === 'simulate' && arg !== undefined) await simulate(arg);
else if (mode === 'resend' && arg !== undefined) await resend(arg);
else if (mode === 'partial') await partial();
else if (mode === 'remove') await remove();
else console.log('Usage: s3-webhooks.ts register <url> | trigger | simulate <type> | remove');
