/**
 * Mock mode only. The stand-in PayPal page runs in its own tab, with its own copy of the mock, so
 * it tells the app's tab about a payment over this channel. That tab then plays PayPal's verified
 * webhook, which is how the real server learns of a payment.
 */
export const MOCK_PAYPAL_CHANNEL = 'terms-mock-paypal';

export interface MockPaymentMessage {
  type: 'invoice.paid';
  dealId: string;
}

/** Messages come from another tab, so they are checked rather than trusted. */
export function isMockPayment(data: unknown): data is MockPaymentMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message['type'] === 'invoice.paid' && typeof message['dealId'] === 'string';
}
