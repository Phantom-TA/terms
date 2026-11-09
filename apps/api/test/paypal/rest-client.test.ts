import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/errors.js';
import { PayPalRestError } from '../../src/paypal/errors.js';
import { PayPalRestClient } from '../../src/paypal/rest-client.js';
import {
  hangingFetch,
  jsonResponse,
  paypalError,
  paypalStub,
  stubFetch,
  testPayPalConfig,
  tokenResponse,
} from '../helpers/fake-fetch.js';

const Invoice = z.object({ id: z.string(), status: z.string() });

function client(fetch: typeof globalThis.fetch, now: () => number = Date.now) {
  return new PayPalRestClient(testPayPalConfig, { fetch, backoffMs: 0, now });
}

async function rejection(run: () => Promise<unknown>): Promise<PayPalRestError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof PayPalRestError) return err;
    throw err;
  }
  throw new Error('expected a rejection');
}

describe('PayPalRestClient', () => {
  it('refuses to start without credentials', () => {
    expect(
      () => new PayPalRestClient({ ...testPayPalConfig, clientSecret: null, configured: false }),
    ).toThrow(AppError);
  });

  it('sends a write with a bearer token, the request id and JSON body, and decodes the reply', async () => {
    const stub = paypalStub(
      jsonResponse(200, { id: 'INV2-1', status: 'SENT', extra: 1 }, { 'paypal-debug-id': 'd1' }),
    );
    const res = await client(stub.fetch).request({
      method: 'PUT',
      path: '/v2/invoicing/invoices/INV2-1',
      query: { send_to_recipient: true },
      body: { detail: { note: 'hi' } },
      requestId: 'req-1',
      prefer: 'return=representation',
      schema: Invoice,
    });
    expect(res).toMatchObject({
      status: 200,
      data: { id: 'INV2-1', status: 'SENT' },
      debugId: 'd1',
    });

    const [token, put] = stub.calls;
    expect(token!.request.method).toBe('POST');
    expect(token!.request.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`,
    );
    expect(token!.body).toBe('grant_type=client_credentials');
    expect(put!.request.method).toBe('PUT');
    expect(put!.url.pathname).toBe('/v2/invoicing/invoices/INV2-1');
    expect(put!.url.searchParams.get('send_to_recipient')).toBe('true');
    expect(put!.request.headers.get('authorization')).toBe('Bearer A21AAtesttoken');
    expect(put!.request.headers.get('paypal-request-id')).toBe('req-1');
    expect(put!.request.headers.get('prefer')).toBe('return=representation');
    expect(put!.request.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(put!.body!)).toEqual({ detail: { note: 'hi' } });
  });

  it('caches the token until shortly before it expires, then refreshes it', async () => {
    let clock = 0;
    let tokens = 0;
    const stub = stubFetch((url) => {
      if (url.pathname.endsWith('/v1/oauth2/token')) {
        tokens++;
        return tokenResponse(120);
      }
      return jsonResponse(200, { id: 'x', status: 'SENT' });
    });
    const c = client(stub.fetch, () => clock);
    const get = () =>
      c.request({ method: 'GET', path: '/v2/invoicing/invoices/x', schema: Invoice });
    await Promise.all([get(), get()]); // concurrent callers share one token request
    expect(tokens).toBe(1);
    clock = 59_000;
    await get();
    expect(tokens).toBe(1);
    clock = 61_000; // past expires_in − 60 s
    await get();
    expect(tokens).toBe(2);
  });

  it('retries a read on 5xx and a dropped connection, but never a write', async () => {
    let n = 0;
    const flaky = stubFetch((url) => {
      if (url.pathname.endsWith('/v1/oauth2/token')) return tokenResponse();
      n++;
      if (n === 1) return jsonResponse(503, {});
      if (n === 2) throw new Error('ECONNRESET');
      return jsonResponse(200, { id: 'x', status: 'SENT' });
    });
    const c = client(flaky.fetch);
    await expect(
      c.request({ method: 'GET', path: '/v2/invoicing/invoices/x', schema: Invoice }),
    ).resolves.toMatchObject({ data: { id: 'x' } });
    expect(flaky.apiCalls()).toHaveLength(3);

    const once = paypalStub(jsonResponse(503, paypalError('INTERNAL', 'down')));
    const err = await rejection(() =>
      client(once.fetch).request({
        method: 'POST',
        path: '/v2/invoicing/invoices/x/remind',
        body: {},
        schema: z.unknown(),
      }),
    );
    expect(err).toMatchObject({ kind: 'api', status: 503 });
    expect(once.apiCalls()).toHaveLength(1);
  });

  it('raises a refusal with the parsed body, and drops the token on 401', async () => {
    let tokens = 0;
    let n = 0;
    const stub = stubFetch((url) => {
      if (url.pathname.endsWith('/v1/oauth2/token')) {
        tokens++;
        return tokenResponse();
      }
      n++;
      return n === 1
        ? jsonResponse(401, { name: 'AUTHENTICATION_FAILURE', message: 'expired' })
        : jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Invalid amount'));
    });
    const c = client(stub.fetch);
    const first = await rejection(() =>
      c.request({ method: 'POST', path: '/v2/invoicing/invoices', body: {}, schema: Invoice }),
    );
    expect(first.status).toBe(401);
    const second = await rejection(() =>
      c.request({ method: 'POST', path: '/v2/invoicing/invoices', body: {}, schema: Invoice }),
    );
    expect(second).toMatchObject({ kind: 'api', status: 422 });
    expect(second.body).toMatchObject({ name: 'UNPROCESSABLE_ENTITY' });
    expect(tokens).toBe(2); // re-acquired after the 401
  });

  it('reports an unreadable success body as a decode failure', async () => {
    const stub = paypalStub(
      jsonResponse(200, { id: 7 }),
      new Response('not json', { status: 200 }),
    );
    const c = client(stub.fetch);
    const get = () => c.request({ method: 'GET', path: '/x', schema: Invoice });
    expect((await rejection(get)).kind).toBe('decode');
    expect((await rejection(get)).kind).toBe('decode');
    // An empty body reads as null, so a write whose reply is not read succeeds.
    const empty = paypalStub(new Response(null, { status: 204 }));
    await expect(
      client(empty.fetch).request({ method: 'POST', path: '/y', schema: z.unknown() }),
    ).resolves.toMatchObject({ status: 204, data: null });
  });

  it('times out an attempt, and treats a failed token request as not sent', async () => {
    const hanging = stubFetch((url, request) =>
      url.pathname.endsWith('/v1/oauth2/token') ? tokenResponse() : hangingFetch(request),
    );
    const slow = new PayPalRestClient(testPayPalConfig, {
      fetch: hanging.fetch,
      attemptTimeoutMs: 10,
      maxRetries: 0,
    });
    expect(
      (await rejection(() => slow.request({ method: 'GET', path: '/x', schema: Invoice }))).kind,
    ).toBe('timeout');

    const refused = stubFetch(() => jsonResponse(401, { error: 'invalid_client' }));
    const err = await rejection(() =>
      client(refused.fetch).request({ method: 'POST', path: '/x', body: {}, schema: Invoice }),
    );
    expect(err.kind).toBe('auth');
    expect(err.cause).toBeInstanceOf(PayPalRestError);
    expect(refused.apiCalls()).toHaveLength(0);

    const down = stubFetch(() => {
      throw new Error('ENOTFOUND');
    });
    expect(
      (
        await rejection(() =>
          client(down.fetch).request({ method: 'GET', path: '/x', schema: Invoice }),
        )
      ).kind,
    ).toBe('auth');
  });

  it('rejects with the caller’s own reason when the caller aborts', async () => {
    const hanging = stubFetch((url, request) =>
      url.pathname.endsWith('/v1/oauth2/token') ? tokenResponse() : hangingFetch(request),
    );
    const controller = new AbortController();
    const reason = new Error('client went away');
    const pending = client(hanging.fetch).request({
      method: 'GET',
      path: '/x',
      schema: Invoice,
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort(reason);
    }, 5);
    await expect(pending).rejects.toBe(reason);
  });
});
