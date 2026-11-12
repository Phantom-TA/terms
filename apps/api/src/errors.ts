/**
 * Typed application errors. Every error that reaches the HTTP layer becomes an `ApiErrorBody`
 * from @terms/shared, so the UI can show the code, the policy checks or the PayPal debug ID.
 */
import {
  type ApiErrorBody,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  type PayPalErrorInfo,
  type PolicyCheck,
  type ValidationIssue,
} from '@terms/shared';

export interface AppErrorOptions {
  retryable?: boolean;
  issues?: ValidationIssue[];
  policyChecks?: PolicyCheck[];
  paypal?: PayPalErrorInfo;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly issues: ValidationIssue[] | undefined;
  readonly policyChecks: PolicyCheck[] | undefined;
  readonly paypal: PayPalErrorInfo | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_HTTP_STATUS[code];
    this.retryable = options.retryable ?? false;
    this.issues = options.issues;
    this.policyChecks = options.policyChecks;
    this.paypal = options.paypal;
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(requestId === undefined ? {} : { requestId }),
        ...(this.issues === undefined ? {} : { issues: this.issues }),
        ...(this.policyChecks === undefined ? {} : { policyChecks: this.policyChecks }),
        ...(this.paypal === undefined ? {} : { paypal: this.paypal }),
      },
    };
  }
}

export const notFound = (what: string): AppError => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (message: string): AppError => new AppError('CONFLICT', message);
export const forbidden = (message = 'Not allowed for this business'): AppError =>
  new AppError('FORBIDDEN', message);
export const policyBlocked = (message: string, policyChecks: PolicyCheck[]): AppError =>
  new AppError('POLICY_BLOCKED', message, { policyChecks });
