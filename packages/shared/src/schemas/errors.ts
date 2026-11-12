import { z } from 'zod';
import { PolicyCheckView } from './common.js';

export const ErrorCode = z.enum([
  /** Request body, query or params failed schema validation (400). */
  'VALIDATION_FAILED',
  /** No session, or the session has expired (401). */
  'UNAUTHENTICATED',
  /** The session's business may not use this route or record (403). */
  'FORBIDDEN',
  /** The record does not exist or is not visible to this session (404). */
  'NOT_FOUND',
  /** The record is in a state that does not allow this action, e.g. editing an approved plan (409). */
  'CONFLICT',
  /** A deterministic policy check blocked the action; `policyChecks` says which (422). */
  'POLICY_BLOCKED',
  /** The offer token is invalid, expired or already used (410). */
  'TOKEN_INVALID',
  /** PayPal returned an error; `paypal.debugId` identifies it (502). */
  'PAYPAL_ERROR',
  /** The AI provider failed or returned output that did not validate (502). */
  'AI_ERROR',
  /** Too many requests (429). */
  'RATE_LIMITED',
  /** A dependency the feature needs is not configured, e.g. missing PayPal credentials (503). */
  'NOT_CONFIGURED',
  /** Unexpected server error (500). */
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOKEN_INVALID: 410,
  POLICY_BLOCKED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  PAYPAL_ERROR: 502,
  AI_ERROR: 502,
  NOT_CONFIGURED: 503,
};

export const ValidationIssue = z.object({
  /** Dotted path to the field, e.g. "terms.discountPct". Empty for the whole body. */
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const PayPalErrorInfo = z.object({
  /** PayPal-Debug-Id header value; shown in the UI with a retry button. */
  debugId: z.string().nullable(),
  /** PayPal error name, e.g. "UNPROCESSABLE_ENTITY". */
  name: z.string().nullable(),
  message: z.string(),
  httpStatus: z.number().int(),
});
export type PayPalErrorInfo = z.infer<typeof PayPalErrorInfo>;

/** Every non-2xx JSON response has this shape. */
export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Correlates with server logs and the audit trail. */
    requestId: z.string().optional(),
    /** Whether retrying the same request may succeed (PayPal 5xx, rate limits). */
    retryable: z.boolean(),
    issues: z.array(ValidationIssue).optional(),
    policyChecks: z.array(PolicyCheckView).optional(),
    paypal: PayPalErrorInfo.optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
