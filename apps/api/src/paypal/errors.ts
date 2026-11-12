/**
 * One mapping from a PayPal failure to a Terms outcome, used for every PayPal call, SDK or REST
 * (paypal-plan.md, "When PayPal says no"). A failure is first classified, then:
 *  - a write's classification decides whether its claim is released or kept as UNKNOWN;
 *  - `toAppError` turns it into the error the API answers with.
 * PayPal's own reason reaches the caller only when the caller's data was refused (a 4xx other than
 * 401/403/429); our credentials, our quota and PayPal's outages get fixed messages.
 */
import { type PayPalErrorInfo } from '@terms/shared';
import { PaypalError } from 'paypal';
import { z } from 'zod';
import { AppError } from '../errors.js';

export type FailureKind =
  /** PayPal answered a 4xx other than 401/403/429: the request it was sent was refused. */
  | 'refused'
  /** 401/403: our credentials or the app's permissions. */
  | 'unauthorized'
  | 'rate_limited'
  /** PayPal answered 5xx. */
  | 'server'
  /** PayPal answered but the body could not be read; `status` says whether it was a success. */
  | 'unreadable'
  /** No response arrived (connection dropped or the attempt timed out). */
  | 'no_response'
  /** Nothing was sent: no access token could be obtained, or a value would not encode. */
  | 'not_sent';

export interface PayPalFailure {
  kind: FailureKind;
  status: number | null;
  /** PayPal's error name, e.g. UNPROCESSABLE_ENTITY. */
  name: string | null;
  /** PayPal's reason, from `details[].description` or `message`. */
  reason: string | null;
  debugId: string | null;
  /** The method and URL PayPal was called with (no query). For logs, never for responses. */
  call: string | null;
  cause: unknown;
}

/** Raised by our REST client (Invoicing, Webhooks, Payouts, OAuth), shaped like the SDK family. */
export class PayPalRestError extends Error {
  constructor(
    readonly kind: 'api' | 'decode' | 'connection' | 'timeout' | 'auth' | 'encode',
    readonly method: string,
    readonly uri: string,
    readonly status: number | null,
    readonly headers: Headers | null,
    /** Parsed JSON error body when there was one. */
    readonly body: unknown,
    options?: { cause?: unknown },
  ) {
    super(
      `${method} ${uri} ${status === null ? `failed (${kind})` : `failed with ${status}`}`,
      options,
    );
    this.name = 'PayPalRestError';
  }
}

const ErrorBody = z.looseObject({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  debugId: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  details: z
    .array(
      z.looseObject({
        issue: z.string().optional(),
        description: z.string().optional(),
        field: z.string().optional(),
      }),
    )
    .optional(),
});

const MAX_REASON = 500;

/** Reads PayPal's reason out of an error body, whatever its casing. Bodies are never logged. */
export function reasonFrom(body: unknown): {
  name: string | null;
  reason: string | null;
  debugId: string | null;
} {
  const parsed = ErrorBody.safeParse(body);
  if (!parsed.success) return { name: null, reason: null, debugId: null };
  const b = parsed.data;
  const details = (b.details ?? [])
    .map((d) => d.description ?? d.issue)
    .filter((d): d is string => d !== undefined && d.length > 0);
  const reason =
    details.length > 0 ? details.join('; ') : (b.message ?? b.error_description ?? null);
  return {
    name: b.name ?? b.error ?? null,
    reason: reason === null ? null : reason.slice(0, MAX_REASON),
    debugId: b.debug_id ?? b.debugId ?? null,
  };
}

function decodeRaw(raw: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return null;
  }
}

function kindForStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'refused';
}

/**
 * Classifies an error thrown by a PayPal call. Anything outside the SDK family and our REST error
 * (a caller abort's reason, a bug) is rethrown untouched.
 */
export function classify(err: unknown): PayPalFailure {
  if (err instanceof PayPalRestError) {
    const call = `${err.method} ${err.uri}`;
    const fromBody = reasonFrom(err.body);
    const debugId = err.headers?.get('paypal-debug-id') ?? fromBody.debugId;
    const base = { status: err.status, name: fromBody.name, debugId, call, cause: err };
    switch (err.kind) {
      case 'api':
        return { ...base, kind: kindForStatus(err.status ?? 500), reason: fromBody.reason };
      case 'decode':
        return { ...base, kind: 'unreadable', reason: null };
      case 'connection':
      case 'timeout':
        return { ...base, kind: 'no_response', reason: null };
      case 'auth':
      case 'encode':
        return { ...base, kind: 'not_sent', reason: null };
    }
  }
  if (err instanceof PaypalError) {
    const call = `${err.method} ${err.uri}`;
    switch (err.kind) {
      case 'api': {
        // Read the body structurally; arm tags differ per operation and are never switched on here.
        const payload = err.payload as { body?: unknown; rawBody?: ArrayBuffer };
        const body = payload.rawBody === undefined ? payload.body : decodeRaw(payload.rawBody);
        const fromBody = reasonFrom(body);
        return {
          kind: kindForStatus(err.status),
          status: err.status,
          name: fromBody.name,
          reason: fromBody.reason,
          debugId: err.headers.get('paypal-debug-id') ?? fromBody.debugId,
          call,
          cause: err,
        };
      }
      case 'decode':
        return {
          kind: 'unreadable',
          status: err.status,
          name: null,
          reason: null,
          debugId: err.headers.get('paypal-debug-id'),
          call,
          cause: err,
        };
      case 'connection':
      case 'timeout':
        return {
          kind: 'no_response',
          status: null,
          name: null,
          reason: null,
          debugId: null,
          call,
          cause: err,
        };
      case 'auth':
      case 'encode':
        return {
          kind: 'not_sent',
          status: null,
          name: null,
          reason: null,
          debugId: null,
          call,
          cause: err,
        };
    }
  }
  throw err;
}

/**
 * Whether a failed write may have taken effect at PayPal. Such a write is kept UNKNOWN and settled
 * by a re-read, never reported as failed.
 */
export function mayHaveTakenEffect(f: PayPalFailure): boolean {
  if (f.kind === 'no_response') return true;
  // An unreadable success body: PayPal acted and the answer was lost.
  if (f.kind === 'unreadable') return f.status === null || (f.status >= 200 && f.status < 300);
  // A 5xx on a write can follow a partial commit at PayPal; treat it as unknown too.
  return f.kind === 'server';
}

function info(f: PayPalFailure, message: string): PayPalErrorInfo {
  return { debugId: f.debugId, name: f.name, message, httpStatus: f.status ?? 0 };
}

/**
 * The Terms error for a PayPal failure. `what` names the object for a not-found, e.g. "invoice".
 * Writes whose outcome is unknown are answered by the caller (see paypal-plan.md), not here.
 */
export function toAppError(f: PayPalFailure, what: string): AppError {
  const cause = f.cause;
  switch (f.kind) {
    case 'refused': {
      if (f.status === 404) {
        return new AppError('NOT_FOUND', `PayPal has no such ${what}`, {
          paypal: info(f, `PayPal has no such ${what}`),
          cause,
        });
      }
      const message = f.reason ?? 'PayPal rejected the request';
      return new AppError(f.status === 409 ? 'CONFLICT' : 'VALIDATION_FAILED', message, {
        paypal: info(f, message),
        cause,
      });
    }
    case 'unreadable':
      // A Vault 404 arrives as a decode failure (its error body does not fit the SDK schema).
      if (f.status === 404) {
        return new AppError('NOT_FOUND', `PayPal has no such ${what}`, {
          paypal: info(f, `PayPal has no such ${what}`),
          cause,
        });
      }
      return new AppError('PAYPAL_ERROR', 'PayPal sent a response Terms could not read', {
        retryable: false,
        paypal: info(f, 'Unreadable PayPal response'),
        cause,
      });
    case 'unauthorized':
      return new AppError('PAYPAL_ERROR', 'Terms could not authenticate with PayPal', {
        paypal: info(f, 'PayPal refused our credentials'),
        cause,
      });
    case 'rate_limited':
      return new AppError('RATE_LIMITED', 'PayPal is limiting requests; try again shortly', {
        retryable: true,
        paypal: info(f, 'PayPal rate limit'),
        cause,
      });
    case 'server':
      return new AppError('PAYPAL_ERROR', 'PayPal is having trouble; try again shortly', {
        retryable: true,
        paypal: info(f, 'PayPal server error'),
        cause,
      });
    case 'no_response':
      return new AppError('PAYPAL_ERROR', 'PayPal did not respond; try again shortly', {
        retryable: true,
        paypal: info(f, 'No response from PayPal'),
        cause,
      });
    case 'not_sent':
      return new AppError('PAYPAL_ERROR', 'Terms could not reach PayPal with its credentials', {
        paypal: info(f, 'Request not sent'),
        cause,
      });
  }
}

/** A 2xx whose body lacks a member Terms depends on: PayPal acted, but Terms cannot name the result. */
export function incompleteResponse(call: string, status: number | null = null): PayPalFailure {
  return {
    kind: 'unreadable',
    status,
    name: null,
    reason: null,
    debugId: null,
    call,
    cause: null,
  };
}
