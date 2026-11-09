/**
 * A fake `fetch` for PayPal tests (APIMatic typescript-testing: the transport is the seam; never
 * mock the client). Records every request, including the OAuth token request, with its body text.
 */
import { type Config } from '../../src/config.js';

export interface RecordedCall {
  url: URL;
  request: Request;
  body: string | undefined;
}

export type Responder = (url: URL, request: Request) => Response | Promise<Response>;

export function stubFetch(responder: Responder) {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = request.body === null ? undefined : await request.clone().text();
    const call = { url: new URL(request.url), request, body };
    calls.push(call);
    return responder(call.url, request);
  };
  return {
    fetch,
    calls,
    /** Calls other than the OAuth token request. */
    apiCalls: () => calls.filter((c) => !c.url.pathname.endsWith('/v1/oauth2/token')),
    last: (): RecordedCall => {
      const call = calls.at(-1);
      if (call === undefined) throw new Error('no request was made');
      return call;
    },
  };
}

export function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function tokenResponse(expiresIn = 32_400): Response {
  return jsonResponse(200, {
    access_token: 'A21AAtesttoken',
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: 'https://uri.paypal.com/services/invoicing',
  });
}

/** Answers token requests itself and every other request from the queue, in order. */
export function paypalStub(...responses: (Response | (() => Response | Promise<Response>))[]) {
  const queue = [...responses];
  return stubFetch((url) => {
    if (url.pathname.endsWith('/v1/oauth2/token')) return tokenResponse();
    const next = queue.shift();
    if (next === undefined) throw new Error(`stub ran out of responses at ${url.pathname}`);
    return typeof next === 'function' ? next() : next;
  });
}

/** A fake that never answers until the request's signal aborts (for timeout tests). */
export const hangingFetch: typeof globalThis.fetch = (input, init) =>
  new Promise((_resolve, reject) => {
    const { signal } = new Request(input, init);
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });

export const testPayPalConfig: Config['paypal'] = {
  environment: 'sandbox',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  webhookId: 'WH-TEST',
  configured: true,
  baseUrl: 'https://api-m.sandbox.paypal.com',
};

/** PayPal's standard error body (wire shape). */
export function paypalError(name: string, description: string, debugId = 'dbg123') {
  return {
    name,
    message: 'The requested action could not be performed.',
    debug_id: debugId,
    details: [{ issue: name, description }],
    links: [{ href: 'https://developer.paypal.com/docs/api/', rel: 'information_link' }],
  };
}
