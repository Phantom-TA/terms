import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { ApiError } from './errors';

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const session = {
  business: {
    id: 'biz_1',
    name: 'Maya Studio',
    slug: 'maya-studio',
    role: 'SUPPLIER',
    hasAgent: false,
    paypalEmail: null,
    isDemo: true,
  },
  paypalEnvironment: 'sandbox',
  demo: true,
  expiresAt: '2026-11-13T18:00:00Z',
};

function requestAt(index = 0): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index]!;
  return { url: url as string, init: init! };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('returns the response parsed by the shared schema', async () => {
    fetchMock.mockResolvedValue(json(session));
    const result = await api('getSession');
    expect(result.business.name).toBe('Maya Studio');
    expect(requestAt().url).toBe('/api/session');
    expect(requestAt().init.method).toBe('GET');
  });

  it('fills and encodes path parameters', async () => {
    fetchMock.mockResolvedValue(json({ offer: {} }, 500));
    await expect(
      api('updatePlanItem', {
        params: { planId: 'p 1', itemId: 'i/2' },
        body: { discountPct: '1.00' },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(requestAt().url).toBe('/api/plans/p%201/items/i%2F2');
  });

  it('serialises the query and skips undefined values', async () => {
    fetchMock.mockResolvedValue(json({ entries: [], nextCursor: null }));
    await api('listAudit', { query: { actor: 'PAYPAL', limit: 20, cursor: undefined } });
    expect(requestAt().url).toBe('/api/audit?actor=PAYPAL&limit=20');
  });

  it('sends a validated JSON body', async () => {
    fetchMock.mockResolvedValue(json(session, 201));
    await api('createSession', { body: { businessId: 'biz_1' } });
    expect(requestAt().init.body).toBe('{"businessId":"biz_1"}');
  });

  it('rejects an invalid body without calling the server', async () => {
    const bad = api('updatePlanItem', {
      params: { planId: 'p', itemId: 'i' },
      body: { discountPct: '1.2' },
    });
    await expect(bad).rejects.toMatchObject({ kind: 'contract' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves undefined for a 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('deleteSession')).resolves.toBeUndefined();
  });

  it('refuses a success response that does not match the contract', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(json({ business: { id: 'x' } }));
    await expect(api('getSession')).rejects.toMatchObject({ kind: 'contract', status: 200 });
  });

  it('surfaces the PayPal debug ID from an error body', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: {
            code: 'PAYPAL_ERROR',
            message: 'PayPal rejected the invoice update.',
            retryable: true,
            requestId: 'req_9',
            paypal: {
              debugId: 'f4c1a2b3',
              name: 'UNPROCESSABLE_ENTITY',
              message: 'Invalid',
              httpStatus: 422,
            },
          },
        },
        502,
      ),
    );
    const error = await api('getSession').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe('PAYPAL_ERROR');
    expect(apiError.paypalDebugId).toBe('f4c1a2b3');
    expect(apiError.requestId).toBe('req_9');
    expect(apiError.retryable).toBe(true);
  });

  it('keeps policy checks from a blocked action', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: {
            code: 'POLICY_BLOCKED',
            message: 'Blocked by policy.',
            retryable: false,
            policyChecks: [{ rule: 'maxDiscount', result: 'blocked', detail: '1.50% is above' }],
          },
        },
        422,
      ),
    );
    await expect(api('getSession')).rejects.toMatchObject({
      code: 'POLICY_BLOCKED',
      policyChecks: [{ rule: 'maxDiscount', result: 'blocked', detail: '1.50% is above' }],
    });
  });

  it('reports a non-JSON error body honestly', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api('getSession')).rejects.toMatchObject({
      kind: 'server',
      status: 502,
      retryable: true,
      code: null,
    });
  });

  it('turns a failed fetch into a retryable network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('getSession')).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it('lets an abort through unchanged', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(api('getSession')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
