import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { buildPayPalSdkClient, callBudget } from '../../src/paypal/sdk-client.js';
import { jsonResponse, paypalStub, testPayPalConfig } from '../helpers/fake-fetch.js';

describe('buildPayPalSdkClient', () => {
  it('refuses to build without credentials instead of sending unauthenticated calls', () => {
    expect(() =>
      buildPayPalSdkClient({ ...testPayPalConfig, clientId: null, configured: false }),
    ).toThrow(AppError);
  });

  it('calls the configured host with a bearer token and sets no fields of its own choosing', async () => {
    const stub = paypalStub(
      jsonResponse(200, {
        balances: [
          {
            currency: 'USD',
            total_balance: { currency_code: 'USD', value: '5200.00' },
            available_balance: { currency_code: 'USD', value: '5200.00' },
          },
        ],
        account_id: '9L4MR577RS46S',
        as_of_time: '2026-11-09T16:59:59Z',
        last_refresh_time: '2026-11-09T16:59:59Z',
      }),
    );
    const client = buildPayPalSdkClient(
      { ...testPayPalConfig, baseUrl: 'https://paypal.test.local' },
      { fetch: stub.fetch, maxRetries: 0 },
    );
    const res = await client.transactionSearch.searchBalances({ currencyCode: 'USD' });
    expect(res.balances?.[0]?.availableBalance?.value).toBe('5200.00');

    const call = stub.apiCalls()[0]!;
    expect(call.url.origin).toBe('https://paypal.test.local');
    expect(call.url.pathname).toBe('/v1/reporting/balances');
    expect([...call.url.searchParams.keys()]).toEqual(['currency_code']);
    expect(call.request.headers.get('authorization')).toBe('Bearer A21AAtesttoken');
    // The token request reached the same overridden host.
    expect(stub.calls[0]!.url.origin).toBe('https://paypal.test.local');
  });

  it('bounds a whole call with a deadline linked to the caller', () => {
    const caller = new AbortController();
    const signal = callBudget(caller.signal);
    expect(signal.aborted).toBe(false);
    caller.abort(new Error('gone'));
    expect(signal.aborted).toBe(true);
    expect(callBudget().aborted).toBe(false);
  });
});
