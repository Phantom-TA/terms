/**
 * The parts of PayPal's Invoicing v2 wire format Terms reads, as observed in spikes S1–S3
 * (docs/paypal.md). Objects are loose: the full invoice is round-tripped on a full update, so
 * fields Terms does not model must survive untouched.
 */
import { toCents } from '@terms/shared';
import { z } from 'zod';

export const WireMoney = z.looseObject({ currency_code: z.string(), value: z.string() });

export const WireInvoice = z.looseObject({
  id: z.string(),
  status: z.string(),
  detail: z.looseObject({
    invoice_number: z.string().optional(),
    currency_code: z.string().optional(),
    payment_term: z.looseObject({ due_date: z.string().optional() }).optional(),
    metadata: z
      .looseObject({
        recipient_view_url: z.string().optional(),
        last_update_time: z.string().optional(),
      })
      .optional(),
  }),
  amount: z
    .looseObject({
      currency_code: z.string(),
      value: z.string(),
      breakdown: z
        .looseObject({
          item_total: WireMoney.optional(),
          discount: z
            .looseObject({
              invoice_discount: z
                .looseObject({ amount: WireMoney.optional(), percent: z.string().optional() })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  due_amount: WireMoney.optional(),
  payments: z
    .looseObject({
      paid_amount: WireMoney.optional(),
      transactions: z
        .array(
          z.looseObject({
            payment_id: z.string().optional(),
            method: z.string().optional(),
            amount: WireMoney.optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  configuration: z
    .looseObject({
      partial_payment: z
        .looseObject({
          allow_partial_payment: z.boolean().optional(),
          minimum_amount_due: WireMoney.optional(),
        })
        .optional(),
    })
    .optional(),
  primary_recipients: z
    .array(
      z.looseObject({
        billing_info: z.looseObject({ email_address: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});
export type WireInvoice = z.infer<typeof WireInvoice>;

/** Amounts Terms derives from a PayPal invoice, in cents. */
export interface InvoiceFigures {
  totalCents: bigint;
  /** The invoice-level discount currently applied, as a positive amount. */
  discountCents: bigint;
  paidCents: bigint;
  dueCents: bigint;
  minimumCents: bigint | null;
}

function cents(value: string | undefined): bigint {
  return value === undefined ? 0n : toCents(value);
}

export function figuresOf(invoice: WireInvoice): InvoiceFigures {
  const total = cents(invoice.amount?.value);
  // PayPal stores the invoice discount as a negative amount (spike S1).
  const discount = cents(invoice.amount?.breakdown?.discount?.invoice_discount?.amount?.value);
  const paid = cents(invoice.payments?.paid_amount?.value);
  const partial = invoice.configuration?.partial_payment;
  const minimum = partial?.minimum_amount_due?.value;
  return {
    totalCents: total,
    discountCents: discount < 0n ? -discount : discount,
    paidCents: paid,
    dueCents: invoice.due_amount === undefined ? total - paid : cents(invoice.due_amount.value),
    minimumCents:
      partial?.allow_partial_payment === true && minimum !== undefined ? toCents(minimum) : null,
  };
}

/** PayPal invoice statuses Terms mirrors; anything else is kept as UNPAID-like SENT. */
export const MIRRORED_STATUSES = [
  'DRAFT',
  'SENT',
  'SCHEDULED',
  'UNPAID',
  'PAYMENT_PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'MARKED_AS_PAID',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'MARKED_AS_REFUNDED',
] as const;
export type MirroredStatus = (typeof MIRRORED_STATUSES)[number];

export function mirroredStatus(status: string): MirroredStatus {
  return (MIRRORED_STATUSES as readonly string[]).includes(status)
    ? (status as MirroredStatus)
    : 'SENT';
}
