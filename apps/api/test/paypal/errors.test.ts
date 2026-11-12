import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import {
  classify,
  mayHaveTakenEffect,
  PayPalRestError,
  reasonFrom,
  toAppError,
} from '../../src/paypal/errors.js';
import { buildPayPalSdkClient } from '../../src/paypal/sdk-client.js';
import {
  hangingFetch,
  jsonResponse,
  paypalError,
  paypalStub,
  stubFetch,
  testPayPalConfig,
  tokenResponse,
} from '../helpers/fake-fetch.js';

function sdk(fetch: typeof globalThis.fetch) {
  return buildPayPalSdkClient(testPayPalConfig, { fetch, maxRetries: 0 });
}

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    return classify(err);
  }
  throw new Error('expected a rejection');
}

describe('PayPal failure classification (SDK, through a fake fetch)', () => {
  it('passes PayPal’s reason through when the request is refused', async () => {
    const stub = paypalStub(
      jsonResponse(422, paypalError('UNPROCESSABLE_ENTITY', 'Amount must be positive'), {
        'paypal-debug-id': 'f00d',
      }),
    );
    const f = await failureOf(() => sdk(stub.fetch).orders.getOrder({ id: 'ORDER1' }));
    expect(f).toMatchObject({
      kind: 'refused',
      status: 422,
      name: 'UNPROCESSABLE_ENTITY',
      reason: 'Amount must be positive',
      debugId: 'f00d',
    });
    expect(mayHaveTakenEffect(f)).toBe(false);
    const app = toAppError(f, 'order');
    expect(app.code).toBe('VALIDATION_FAILED');
    expect(app.toBody().error).toMatchObject({
      message: 'Amount must be positive',
      paypal: { debugId: 'f00d', name: 'UNPROCESSABLE_ENTITY', httpStatus: 422 },
    });
  });

  it('maps 404, 409, our credentials, our quota and PayPal outages', async () => {
    const cases: [number, string, string][] = [
      [404, 'NOT_FOUND', 'PayPal has no such order'],
      [401, 'PAYPAL_ERROR', 'Terms could not authenticate with PayPal'],
      [403, 'PAYPAL_ERROR', 'Terms could not authenticate with PayPal'],
      [429, 'RATE_LIMITED', 'PayPal is limiting requests; try again shortly'],
      [500, 'PAYPAL_ERROR', 'PayPal is having trouble; try again shortly'],
    ];
    for (const [status, code, message] of cases) {
      const stub = paypalStub(jsonResponse(status, paypalError('X', 'secret detail')));
      const f = await failureOf(() => sdk(stub.fetch).orders.getOrder({ id: 'ORDER1' }));
      const app = toAppError(f, 'order');
      expect([status, app.code, app.message]).toEqual([status, code, message]);
      // Our own credential or quota problems never show PayPal's text to the caller.
      if (status !== 404) expect(app.message).not.toContain('secret detail');
    }
    const conflict = classify(
      new PayPalRestError('api', 'POST', 'u', 409, new Headers(), paypalError('DUP', 'Already')),
    );
    expect(toAppError(conflict, 'invoice').code).toBe('CONFLICT');
  });

  it('treats a Vault 404 that fails the SDK schema as not found', async () => {
    // Observed in the sandbox: Vault error links have no `rel`, which the SDK model requires.
    const body = {
      name: 'RESOURCE_NOT_FOUND',
      message: 'The specified resource does not exist.',
      debug_id: 'abc',
      details: [
        { issue: 'INVALID_RESOURCE_ID', description: 'Specified resource ID does not exist.' },
      ],
      links: [{ href: 'https://developer.paypal.com/api/rest/reference/orders/v2/errors/' }],
    };
    const stub = paypalStub(jsonResponse(404, body));
    const f = await failureOf(() => sdk(stub.fetch).vault.getSetupToken({ id: 'SETUP1' }));
    expect(f).toMatchObject({ kind: 'unreadable', status: 404 });
    expect(mayHaveTakenEffect(f)).toBe(false);
    expect(toAppError(f, 'setup token').code).toBe('NOT_FOUND');
  });

  it('treats an unreadable success body on a write as a possible effect', async () => {
    // `id` must be a string on Order; a number is a type mismatch, so decoding fails on a 2xx.
    const stub = paypalStub(jsonResponse(201, { id: 42, status: 'COMPLETED' }));
    const f = await failureOf(() =>
      sdk(stub.fetch).orders.createOrder({
        body: {
          intent: 'CAPTURE',
          purchaseUnits: [{ amount: { currencyCode: 'USD', value: '1.00' } }],
        },
      }),
    );
    expect(f).toMatchObject({ kind: 'unreadable', status: 201 });
    expect(mayHaveTakenEffect(f)).toBe(true);
    expect(toAppError(f, 'order').code).toBe('PAYPAL_ERROR');
  });

  it('separates a request that never left from one whose answer was lost', async () => {
    const dropped = stubFetch((url) => {
      if (url.pathname.endsWith('/v1/oauth2/token')) {
        return jsonResponse(200, { access_token: 'T', token_type: 'Bearer', expires_in: 3600 });
      }
      throw new Error('ECONNRESET');
    });
    const lost = await failureOf(() => sdk(dropped.fetch).orders.getOrder({ id: 'ORDER1' }));
    expect(lost.kind).toBe('no_response');
    expect(mayHaveTakenEffect(lost)).toBe(true);
    expect(toAppError(lost, 'order').retryable).toBe(true);

    const refusedToken = stubFetch(() => jsonResponse(401, { error: 'invalid_client' }));
    const notSent = await failureOf(() => sdk(refusedToken.fetch).orders.getOrder({ id: 'O' }));
    expect(notSent.kind).toBe('not_sent');
    expect(mayHaveTakenEffect(notSent)).toBe(false);
    // Only the token request went out.
    expect(refusedToken.apiCalls()).toHaveLength(0);
  });

  it('classifies an attempt timeout as no response', async () => {
    // The token request runs on its own timer, so answer it and hang only the operation.
    const fetch: typeof globalThis.fetch = (input, init) => {
      const request = new Request(input, init);
      return request.url.endsWith('/v1/oauth2/token')
        ? Promise.resolve(tokenResponse())
        : hangingFetch(request);
    };
    const client = buildPayPalSdkClient(testPayPalConfig, { fetch, maxRetries: 0 });
    const f = await failureOf(() =>
      client.orders.getOrder({ id: 'O' }, { retry: { timeout: 10 } }),
    );
    expect(f.kind).toBe('no_response');
  });

  it('rethrows anything outside the PayPal error families', () => {
    const bug = new TypeError('boom');
    expect(() => classify(bug)).toThrow(bug);
  });
});

describe('PayPal REST failures', () => {
  it('classifies each kind and reads the reason in either casing', () => {
    const headers = new Headers({ 'paypal-debug-id': 'hdr' });
    const refused = classify(
      new PayPalRestError('api', 'PUT', 'u', 400, headers, paypalError('INVALID_REQUEST', 'Bad')),
    );
    expect(refused).toMatchObject({
      kind: 'refused',
      reason: 'Bad',
      debugId: 'hdr',
      call: 'PUT u',
    });
    expect(classify(new PayPalRestError('decode', 'GET', 'u', 200, headers, null)).kind).toBe(
      'unreadable',
    );
    expect(classify(new PayPalRestError('timeout', 'GET', 'u', null, null, null)).kind).toBe(
      'no_response',
    );
    expect(classify(new PayPalRestError('auth', 'GET', 'u', null, null, null)).kind).toBe(
      'not_sent',
    );
    expect(classify(new PayPalRestError('encode', 'GET', 'u', null, null, null)).kind).toBe(
      'not_sent',
    );
    const server = classify(new PayPalRestError('api', 'POST', 'u', 503, null, null));
    expect(server.kind).toBe('server');
    expect(mayHaveTakenEffect(server)).toBe(true);
    expect(
      toAppError(classify(new PayPalRestError('auth', 'GET', 'u', null, null, null)), 'x'),
    ).toBeInstanceOf(AppError);
  });

  it('extracts reasons from PayPal and OAuth bodies, capped', () => {
    expect(reasonFrom({ name: 'N', message: 'M', debugId: 'D' })).toEqual({
      name: 'N',
      reason: 'M',
      debugId: 'D',
    });
    expect(
      reasonFrom({ error: 'invalid_client', error_description: 'Client Authentication failed' }),
    ).toEqual({ name: 'invalid_client', reason: 'Client Authentication failed', debugId: null });
    expect(reasonFrom('<html>')).toEqual({ name: null, reason: null, debugId: null });
    expect(reasonFrom({ message: 'x'.repeat(900) }).reason).toHaveLength(500);
    expect(
      reasonFrom({ details: [{ issue: 'A' }, { issue: 'B', description: 'b happened' }] }).reason,
    ).toBe('A; b happened');
  });

  it('maps unreadable non-404 errors and no-response to fixed messages', () => {
    const unreadable = toAppError(
      classify(new PayPalRestError('decode', 'GET', 'u', 500, null, null)),
      'invoice',
    );
    expect(unreadable.message).toBe('PayPal sent a response Terms could not read');
    const refusedNoReason = toAppError(
      classify(new PayPalRestError('api', 'POST', 'u', 400, null, '<html>')),
      'invoice',
    );
    expect(refusedNoReason.message).toBe('PayPal rejected the request');
  });
});
