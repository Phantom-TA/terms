/**
 * Spike S1 (CONTEXT.md): can a SENT invoice be fully updated with a discount and a partial-payment
 * minimum, and does the payer see the new total and minimum?
 *
 * Creates two real sandbox invoices from Maya Studio, sends them, then applies the demo's agreed
 * terms with a full update (PUT):
 *  - Harbor & Co, $7,500: discount $21.00 and partial-payment minimum $1,729.00 (split deal);
 *  - Juniper Labs, $5,000: discount $40.00 on the whole invoice (full early payment).
 * Pass criteria: PUT succeeds on a SENT invoice; the invoice reads back with the new total and
 * minimum, still payable (SENT/UNPAID). Fallback if not: cancel and reissue.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accounts, isoDate, rest, save, step } from './lib.js';

const Money = z.looseObject({ currency_code: z.string(), value: z.string() });
const Invoice = z.looseObject({
  id: z.string(),
  status: z.string(),
  detail: z.looseObject({ invoice_number: z.string().optional() }),
  amount: z.looseObject({ value: z.string(), currency_code: z.string() }).optional(),
  due_amount: Money.optional(),
  configuration: z
    .looseObject({
      partial_payment: z
        .looseObject({
          allow_partial_payment: z.boolean().optional(),
          minimum_amount_due: Money.optional(),
        })
        .optional(),
    })
    .optional(),
  links: z.array(z.looseObject({ href: z.string(), rel: z.string() })).optional(),
});
type Invoice = z.infer<typeof Invoice>;
const Created = z.looseObject({ id: z.string().optional(), href: z.string().optional() });

function invoiceIdFrom(created: z.infer<typeof Created>): string {
  if (created.id !== undefined) return created.id;
  const id = created.href?.split('/').pop();
  if (id === undefined) throw new Error('Create invoice returned no id');
  return id;
}

async function createAndSend(
  client: string,
  businessName: string,
  amount: string,
  dueInDays: number,
) {
  const number = `S1-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`;
  const created = await step(`create draft ${number} to ${businessName} for $${amount}`, () =>
    rest.request({
      method: 'POST',
      path: '/v2/invoicing/invoices',
      requestId: randomUUID(),
      prefer: 'return=representation',
      body: {
        detail: {
          invoice_number: number,
          currency_code: 'USD',
          invoice_date: isoDate(0),
          payment_term: { due_date: isoDate(dueInDays) },
          note: 'Terms spike S1 (sandbox demo data)',
        },
        primary_recipients: [
          { billing_info: { email_address: client, business_name: businessName } },
        ],
        items: [
          {
            name: 'Design services',
            quantity: '1',
            unit_amount: { currency_code: 'USD', value: amount },
          },
        ],
        configuration: { allow_tip: false, partial_payment: { allow_partial_payment: false } },
      },
      schema: Created,
    }),
  );
  const id = invoiceIdFrom(created.data);
  await step(`send ${id}`, () =>
    rest.request({
      method: 'POST',
      path: `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`,
      requestId: randomUUID(),
      body: { send_to_invoicer: false, send_to_recipient: true },
      schema: z.unknown(),
    }),
  );
  return get(id, 'after send');
}

async function get(id: string, label: string): Promise<Invoice> {
  const res = await step(`read ${id} ${label}`, () =>
    rest.request({
      method: 'GET',
      path: `/v2/invoicing/invoices/${encodeURIComponent(id)}`,
      schema: Invoice,
    }),
  );
  return res.data;
}

/** Full update: the invoice as PayPal holds it, with the agreed discount and partial minimum. */
async function applyTerms(current: Invoice, discount: string, minimum: string | null) {
  const { id } = current;
  const raw = (
    await rest.request({
      method: 'GET',
      path: `/v2/invoicing/invoices/${encodeURIComponent(id)}`,
      schema: z.looseObject({}),
    })
  ).data;
  const amount = (raw['amount'] ?? {}) as Record<string, unknown>;
  const breakdown = (amount['breakdown'] ?? {}) as Record<string, unknown>;
  const configuration = (raw['configuration'] ?? {}) as Record<string, unknown>;
  const body = {
    ...raw,
    amount: {
      ...amount,
      // PayPal checks the total against the breakdown (`calculation_error` otherwise).
      value: minus(String(amount['value']), discount),
      breakdown: {
        ...breakdown,
        discount: { invoice_discount: { amount: { currency_code: 'USD', value: discount } } },
      },
    },
    configuration: {
      ...configuration,
      partial_payment:
        minimum === null
          ? { allow_partial_payment: false }
          : {
              allow_partial_payment: true,
              minimum_amount_due: { currency_code: 'USD', value: minimum },
            },
    },
  };
  const updated = await step(
    `PUT ${id}: discount $${discount}${minimum === null ? '' : `, minimum $${minimum}`}`,
    () =>
      rest.request({
        method: 'PUT',
        path: `/v2/invoicing/invoices/${encodeURIComponent(id)}`,
        query: { send_to_recipient: true, send_to_invoicer: false },
        requestId: randomUUID(),
        prefer: 'return=representation',
        body,
        schema: Invoice,
      }),
  );
  return { request: body, response: updated.data, readBack: await get(id, 'after update') };
}

function minus(a: string, b: string): string {
  const cents = Math.round(Number(a) * 100) - Math.round(Number(b) * 100);
  return (cents / 100).toFixed(2);
}

function summary(i: Invoice) {
  return {
    id: i.id,
    status: i.status,
    total: i.amount?.value ?? null,
    due: i.due_amount?.value ?? null,
    partial: i.configuration?.partial_payment ?? null,
    payerView: i.links?.find((l) => l.rel === 'payer-view')?.href ?? null,
  };
}

console.log('Spike S1: full update of SENT invoices');
const harbor = await createAndSend(accounts.harbor, 'Harbor & Co', '7500.00', 24);
const juniper = await createAndSend(accounts.juniper, 'Juniper Labs', '5000.00', 18);
const harborUpdate = await applyTerms(harbor, '21.00', '1729.00');
const juniperUpdate = await applyTerms(juniper, '40.00', null);

const result = {
  ranAt: new Date().toISOString(),
  harbor: { before: summary(harbor), after: summary(harborUpdate.readBack) },
  juniper: { before: summary(juniper), after: summary(juniperUpdate.readBack) },
  pass:
    harborUpdate.readBack.amount?.value === '7479.00' &&
    harborUpdate.readBack.configuration?.partial_payment?.minimum_amount_due?.value === '1729.00' &&
    juniperUpdate.readBack.amount?.value === '4960.00' &&
    ['SENT', 'UNPAID'].includes(harborUpdate.readBack.status) &&
    ['SENT', 'UNPAID'].includes(juniperUpdate.readBack.status),
};
const path = save('s1-invoice-update', { result, harborUpdate, juniperUpdate });
console.log(JSON.stringify(result, null, 2));
console.log(`Evidence: ${path}`);
