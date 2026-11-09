import {
  ApiErrorBody,
  type ErrorCode,
  type PayPalErrorInfo,
  type PolicyCheckView,
  type ValidationIssue,
} from '@terms/shared';

/**
 * server: the API answered with an error.
 * network: the request never got an answer.
 * contract: a body did not match the shared schema, so the UI refuses to show it.
 */
export type ApiErrorKind = 'server' | 'network' | 'contract';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number | null;
  code?: ErrorCode | null;
  retryable?: boolean;
  requestId?: string | null;
  issues?: readonly ValidationIssue[];
  policyChecks?: readonly PolicyCheckView[];
  paypal?: PayPalErrorInfo | null;
}

/** Every failure from the API client. Carries what `ErrorState` needs, including PayPal's debug ID. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: ErrorCode | null;
  readonly retryable: boolean;
  readonly requestId: string | null;
  readonly issues: readonly ValidationIssue[];
  readonly policyChecks: readonly PolicyCheckView[];
  readonly paypal: PayPalErrorInfo | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.retryable = init.retryable ?? false;
    this.requestId = init.requestId ?? null;
    this.issues = init.issues ?? [];
    this.policyChecks = init.policyChecks ?? [];
    this.paypal = init.paypal ?? null;
  }

  /** The debug ID PayPal returned, when this failure came from PayPal. */
  get paypalDebugId(): string | null {
    return this.paypal?.debugId ?? null;
  }
}

/** Builds an ApiError from a non-2xx response. A body that isn't `ApiErrorBody` is still reported. */
export function apiErrorFromResponse(status: number, body: unknown): ApiError {
  const parsed = ApiErrorBody.safeParse(body);
  if (!parsed.success) {
    return new ApiError({
      kind: 'server',
      status,
      message: `The server returned an unexpected error (HTTP ${status}).`,
      retryable: status >= 500,
    });
  }
  const { code, message, requestId, retryable, issues, policyChecks, paypal } = parsed.data.error;
  return new ApiError({
    kind: 'server',
    status,
    code,
    message,
    retryable,
    requestId: requestId ?? null,
    issues: issues ?? [],
    policyChecks: policyChecks ?? [],
    paypal: paypal ?? null,
  });
}

/** Normalises anything thrown into an ApiError, for display. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError({
    kind: 'network',
    message: error instanceof Error ? error.message : 'Something went wrong.',
    retryable: true,
  });
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'UNAUTHENTICATED';
}
