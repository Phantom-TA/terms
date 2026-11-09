/**
 * A small REST client for the PayPal APIs the APIMatic SDK does not carry: Invoicing, Webhooks and
 * Payouts (paypal-plan.md, Scope). It mirrors the SDK's posture: one long-lived instance with a
 * cached OAuth token, PayPal-Request-Id on writes, retries only for reads, a per-attempt timeout,
 * and failures raised as `PayPalRestError` so `classify` treats both carriers alike.
 */
import { type z } from 'zod';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { PayPalRestError } from './errors.js';
import { PAYPAL_ATTEMPT_TIMEOUT_MS } from './sdk-client.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RestRequest<T> {
  method: HttpMethod;
  /** Path with ids already encoded, e.g. `/v2/invoicing/invoices/INV2-ABC`. */
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  /** Sent as PayPal-Request-Id: the write ledger's request id. */
  requestId?: string;
  /** `return=representation` where the response body is needed. */
  prefer?: 'return=minimal' | 'return=representation';
  /** Validates the success body (`z.unknown()` when it is not read; an empty body is `null`). */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export interface RestResponse<T> {
  status: number;
  headers: Headers;
  data: T;
  debugId: string | null;
}

export interface RestClientOptions {
  fetch?: typeof globalThis.fetch;
  /** Retries for GET only (default 2). */
  maxRetries?: number;
  attemptTimeoutMs?: number;
  /** Base backoff in ms (default 500). Tests pass 0. */
  backoffMs?: number;
  now?: () => number;
}

interface CachedToken {
  value: string;
  /** Epoch ms after which the token is refreshed (60 s before PayPal's expiry). */
  refreshAt: number;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error);
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class PayPalRestClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly attemptTimeoutMs: number;
  private readonly backoffMs: number;
  private readonly now: () => number;
  private readonly clientId: string;
  private readonly clientSecret: string;
  readonly baseUrl: string;
  private token: CachedToken | null = null;
  private tokenInFlight: Promise<string> | null = null;

  constructor(paypal: Config['paypal'], options: RestClientOptions = {}) {
    if (paypal.clientId === null || paypal.clientSecret === null) {
      throw new AppError(
        'NOT_CONFIGURED',
        'PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET',
      );
    }
    this.clientId = paypal.clientId;
    this.clientSecret = paypal.clientSecret;
    this.baseUrl = paypal.baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? PAYPAL_ATTEMPT_TIMEOUT_MS;
    this.backoffMs = options.backoffMs ?? 500;
    this.now = options.now ?? Date.now;
  }

  /** A cached client-credentials token; concurrent callers share one in-flight request. */
  private async accessToken(method: string, uri: string, signal?: AbortSignal): Promise<string> {
    if (this.token !== null && this.now() < this.token.refreshAt) return this.token.value;
    this.tokenInFlight ??= this.fetchToken(method, uri, signal).finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  private async fetchToken(method: string, uri: string, signal?: AbortSignal): Promise<string> {
    const tokenUri = `${this.baseUrl}/v1/oauth2/token`;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(tokenUri, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: this.attemptSignal(signal),
      });
    } catch (cause) {
      if (signal?.aborted === true) throw signal.reason as Error;
      // The token could not be obtained: nothing of the business call was sent.
      throw new PayPalRestError('auth', method, uri, null, null, null, { cause });
    }
    const body = await readJson(res);
    const parsed = body as { access_token?: unknown; expires_in?: unknown } | null | undefined;
    if (!res.ok || typeof parsed?.access_token !== 'string') {
      const tokenError = new PayPalRestError(
        'api',
        'POST',
        tokenUri,
        res.status,
        res.headers,
        body,
      );
      throw new PayPalRestError('auth', method, uri, null, null, null, { cause: tokenError });
    }
    const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
    this.token = {
      value: parsed.access_token,
      refreshAt: this.now() + Math.max(0, expiresIn - 60) * 1000,
    };
    return parsed.access_token;
  }

  private attemptSignal(caller?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.attemptTimeoutMs);
    return caller === undefined ? timeout : AbortSignal.any([timeout, caller]);
  }

  private url(path: string, query?: RestRequest<unknown>['query']): string {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    return url.toString();
  }

  async request<T>(req: RestRequest<T>): Promise<RestResponse<T>> {
    const url = this.url(req.path, req.query);
    const uri = `${this.baseUrl}${req.path}`;
    const retries = req.method === 'GET' ? this.maxRetries : 0;

    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(req.method, uri, req.signal);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (req.body !== undefined) headers['Content-Type'] = 'application/json';
      if (req.requestId !== undefined) headers['PayPal-Request-Id'] = req.requestId;
      if (req.prefer !== undefined) headers['Prefer'] = req.prefer;

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: req.method,
          headers,
          ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
          signal: this.attemptSignal(req.signal),
        });
      } catch (cause) {
        if (req.signal?.aborted === true) throw req.signal.reason as Error;
        const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
        const error = new PayPalRestError(
          timedOut ? 'timeout' : 'connection',
          req.method,
          uri,
          null,
          null,
          null,
          { cause },
        );
        if (attempt < retries) {
          await sleep(this.backoffMs * 2 ** attempt, req.signal);
          continue;
        }
        throw error;
      }

      if (res.status === 401) this.token = null; // the next call re-acquires
      if (!res.ok) {
        const body = await readJson(res);
        if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
          await sleep(this.backoffMs * 2 ** attempt, req.signal);
          continue;
        }
        throw new PayPalRestError('api', req.method, uri, res.status, res.headers, body);
      }

      const debugId = res.headers.get('paypal-debug-id');
      const body = await readJson(res);
      const parsed = req.schema.safeParse(body);
      if (!parsed.success) {
        throw new PayPalRestError('decode', req.method, uri, res.status, res.headers, null, {
          cause: parsed.error,
        });
      }
      return { status: res.status, headers: res.headers, data: parsed.data, debugId };
    }
  }
}
