/**
 * Builds the one long-lived APIMatic PayPal SDK client (Orders, Vault, Transaction Search).
 * Built once at startup and shared: the OAuth token cache and the resource getters live on it.
 * See paypal-plan.md "Host and credentials" and "Retries, timeouts, logging".
 */
import { PaypalClient } from 'paypal';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';

/** Per-attempt budget. A whole logical call is bounded separately by `PAYPAL_CALL_BUDGET_MS`. */
export const PAYPAL_ATTEMPT_TIMEOUT_MS = 15_000;
/** Wall-clock budget for one logical PayPal call, retries and waits included. */
export const PAYPAL_CALL_BUDGET_MS = 30_000;

export interface PayPalClientOverrides {
  /** Test seam: a fake `fetch` (typescript-testing). */
  fetch?: typeof globalThis.fetch;
  /** Tests turn retries off so one stubbed response is one request. */
  maxRetries?: number;
}

export function buildPayPalSdkClient(
  paypal: Config['paypal'],
  overrides: PayPalClientOverrides = {},
): PaypalClient {
  // An unset credential is not an SDK error: the call would go out unauthenticated and 401 later.
  if (paypal.clientId === null || paypal.clientSecret === null) {
    throw new AppError(
      'NOT_CONFIGURED',
      'PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET',
    );
  }
  return new PaypalClient({
    // The SDK declares one environment (sandbox); the host is always stated, never inherited.
    serverOptions: { baseUrl: paypal.baseUrl },
    oauth2: { clientId: paypal.clientId, clientSecret: paypal.clientSecret },
    retry: {
      timeout: PAYPAL_ATTEMPT_TIMEOUT_MS,
      ...(overrides.maxRetries === undefined ? {} : { maxRetries: overrides.maxRetries }),
    },
    // Pinned off so PAYPAL_CLIENT_LOG cannot turn request logging on from outside the code.
    logging: { level: 'off' },
    ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
  });
}

/** A signal bounding one logical call, linked to the caller's own signal when there is one. */
export function callBudget(caller?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(PAYPAL_CALL_BUDGET_MS);
  return caller === undefined ? deadline : AbortSignal.any([deadline, caller]);
}
