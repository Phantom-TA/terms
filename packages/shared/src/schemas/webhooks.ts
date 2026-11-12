import { z } from 'zod';

/**
 * POST /api/webhooks/paypal — called by PayPal only. The body is PayPal's event; the server
 * verifies the signature with PayPal before acting and ignores duplicates by event ID.
 */
export const PayPalWebhookEnvelope = z.looseObject({
  id: z.string().min(1),
  event_type: z.string().min(1),
  create_time: z.string(),
  resource_type: z.string().optional(),
  summary: z.string().optional(),
  resource: z.record(z.string(), z.unknown()),
});
export type PayPalWebhookEnvelope = z.infer<typeof PayPalWebhookEnvelope>;

export const WebhookAckResponse = z.object({
  received: z.literal(true),
  /** True when this event ID was already processed. */
  duplicate: z.boolean(),
});
export type WebhookAckResponse = z.infer<typeof WebhookAckResponse>;
