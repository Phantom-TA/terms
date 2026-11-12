/**
 * Spike S2 (CONTEXT.md): can an agent pay an invoice programmatically?
 *
 * Uses the payment token from spike S5 (Harbor & Co's saved PayPal method) and Harbor's invoice
 * from spike S1 ($7,479 with a $1,729 partial-payment minimum):
 *  1. orders.createOrder: $1,729.00 to Maya (the app owner), payment source = the vaulted token,
 *     PayPal-Request-Id set (mandatory for vault_id orders), Prefer: return=representation.
 *  2. orders.captureOrder, only if the order is not already COMPLETED (is vault_id single-step?).
 *  3. Replay step 1 with the same PayPal-Request-Id: must return the same order, not charge again.
 *  4. Record the capture against the invoice: POST /v2/invoicing/invoices/{id}/payments.
 *  5. Read the invoice back. Pass: status PARTIALLY_PAID with $5,750.00 still due.
 *
 *   pnpm spike ../../scripts/spikes/s2-agent-payment.ts pay
 *   pnpm spike ../../scripts/spikes/s2-agent-payment.ts record <orderId>
 *     Re-reads a paid order and retries steps 4–5. Invoicing may not find a capture until PayPal's
 *     reporting data catches up (docs/paypal.md, S2 and S4).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { classify } from '../../apps/api/src/paypal/errors.js';
import { isoDate, rest, save, sdk, step } from './lib.js';

const AMOUNT = '1729.00';

type Order = Awaited<ReturnType<typeof sdk.orders.getOrder>>;

const vault = JSON.parse(
  readFileSync(new URL('./out/s5-vault-state.json', import.meta.url), 'utf8'),
) as { paymentTokenId?: string };
const s1 = JSON.parse(
  readFileSync(new URL('./out/s1-invoice-update.json', import.meta.url), 'utf8'),
) as { result: { harbor: { after: { id: string } } } };
const invoiceId = s1.result.harbor.after.id;

const InvoiceRead = z.looseObject({
  id: z.string(),
  status: z.string(),
  detail: z.looseObject({ invoice_number: z.string() }),
  amount: z.looseObject({ value: z.string() }),
  due_amount: z.looseObject({ value: z.string() }).optional(),
  payments: z
    .looseObject({
      paid_amount: z.looseObject({ value: z.string() }).optional(),
      transactions: z.array(z.looseObject({})).optional(),
    })
    .optional(),
});

function readInvoice(label: string) {
  return step(`read invoice ${invoiceId} ${label}`, () =>
    rest.request({
      method: 'GET',
      path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
      schema: InvoiceRead,
    }),
  );
}

function createOrder(vaultId: string, invoiceNumber: string, requestId: string) {
  return sdk.orders.createOrder({
    payPalRequestId: requestId,
    prefer: 'return=representation',
    body: {
      intent: 'CAPTURE',
      purchaseUnits: [
        {
          amount: { currencyCode: 'USD', value: AMOUNT },
          invoiceId: `${invoiceNumber}-S2`,
          customId: 'spike-s2-deal',
        },
      ],
      paymentSource: { paypal: { vaultId } },
    },
  });
}

function captureOf(order: Order) {
  const capture = order.purchaseUnits?.[0]?.payments?.captures?.[0];
  if (capture?.id === undefined) throw new Error(`No capture on order ${order.id ?? '?'}`);
  return { ...capture, id: capture.id };
}

/** Steps 4–5. Returns null when Invoicing refuses the record. */
async function recordAndRead(captureId: string) {
  let recordedId: string | null = null;
  let recordError: string | null = null;
  try {
    const recorded = await step(`record payment ${captureId} against ${invoiceId}`, () =>
      rest.request({
        method: 'POST',
        path: `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`,
        requestId: randomUUID(),
        body: {
          method: 'PAYPAL',
          payment_id: captureId,
          payment_date: isoDate(0),
          amount: { currency_code: 'USD', value: AMOUNT },
          note: 'Paid by Harbor & Co agent from saved PayPal method (Terms spike S2)',
        },
        schema: z.looseObject({ payment_id: z.string().optional() }),
      }),
    );
    recordedId = recorded.data.payment_id ?? null;
  } catch (err) {
    const f = classify(err);
    recordError = `${String(f.status)} ${f.name ?? ''} ${f.reason ?? ''} (debug ${f.debugId ?? '-'})`;
  }
  const after = await readInvoice('after recording');
  return {
    recordedId,
    recordError,
    invoice: {
      status: after.data.status,
      paid: after.data.payments?.paid_amount?.value ?? null,
      due: after.data.due_amount?.value ?? null,
    },
    pass: after.data.status === 'PARTIALLY_PAID' && after.data.due_amount?.value === '5750.00',
  };
}

async function pay(): Promise<void> {
  const vaultId = vault.paymentTokenId;
  if (vaultId === undefined) throw new Error('Run spike S5 first');
  const before = await readInvoice('before payment');
  const requestId = randomUUID();
  let order = await step(`orders.createOrder $${AMOUNT} with vault_id`, () =>
    createOrder(vaultId, before.data.detail.invoice_number, requestId),
  );
  const singleStep = order.status === 'COMPLETED';
  const orderId = order.id;
  if (!singleStep && orderId !== undefined) {
    order = await step(`orders.captureOrder ${orderId}`, () =>
      sdk.orders.captureOrder({
        id: orderId,
        payPalRequestId: randomUUID(),
        prefer: 'return=representation',
      }),
    );
  }
  const capture = captureOf(order);
  const replay = await step('replay orders.createOrder with the same PayPal-Request-Id', () =>
    createOrder(vaultId, before.data.detail.invoice_number, requestId),
  );
  const record = await recordAndRead(capture.id);
  const result = {
    ranAt: new Date().toISOString(),
    orderId: order.id ?? null,
    orderStatus: order.status ?? null,
    singleStep,
    captureId: capture.id,
    captureStatus: capture.status ?? null,
    replaySameOrder: replay.id === order.id,
    ...record,
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(`Evidence: ${save('s2-agent-payment', { result, order })}`);
}

async function record(orderId: string): Promise<void> {
  const order = await step(`orders.getOrder ${orderId}`, () =>
    sdk.orders.getOrder({ id: orderId }),
  );
  const capture = captureOf(order);
  const result = {
    ranAt: new Date().toISOString(),
    orderId,
    captureId: capture.id,
    ...(await recordAndRead(capture.id)),
  };
  console.log(JSON.stringify(result, null, 2));
  console.log(`Evidence: ${save(`s2-record-${Date.now().toString()}`, result)}`);
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'pay') await pay();
else if (mode === 'record' && arg !== undefined) await record(arg);
else console.log('Usage: s2-agent-payment.ts pay | record <orderId>');
