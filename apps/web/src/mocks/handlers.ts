import { type ApiErrorBody, type ErrorCode, ERROR_HTTP_STATUS, paths } from '@terms/shared';
import { http, HttpResponse } from 'msw';
import { businesses, health, sessionFor } from './fixtures';

const SESSION_KEY = 'terms.mock.session';
/** Set this sessionStorage key to fail matching API calls, for error-state tests. */
export const MOCK_FAILURE_KEY = 'terms.mock.fail';

function errorResponse(code: ErrorCode, message: string, retryable = false) {
  const body: ApiErrorBody = { error: { code, message, retryable } };
  return HttpResponse.json(body, { status: ERROR_HTTP_STATUS[code] });
}

function shouldFail(): boolean {
  return sessionStorage.getItem(MOCK_FAILURE_KEY) !== null;
}

function paypalFailure() {
  const body: ApiErrorBody = {
    error: {
      code: 'PAYPAL_ERROR',
      message: 'PayPal could not be reached.',
      retryable: true,
      requestId: 'req_mock',
      paypal: {
        debugId: 'mock-debug-id',
        name: 'SERVICE_UNAVAILABLE',
        message: 'Try again',
        httpStatus: 503,
      },
    },
  };
  return HttpResponse.json(body, { status: 502 });
}

export const handlers = [
  http.get(paths.health(), () => HttpResponse.json(health)),

  http.get(paths.businesses(), () => {
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json({ businesses });
  }),

  http.get(paths.session(), () => {
    if (shouldFail()) return paypalFailure();
    const id = sessionStorage.getItem(SESSION_KEY);
    const session = id === null ? null : sessionFor(id);
    return session
      ? HttpResponse.json(session)
      : errorResponse('UNAUTHENTICATED', 'No demo session.');
  }),

  http.post(paths.session(), async ({ request }) => {
    const { businessId } = (await request.json()) as { businessId: string };
    const session = sessionFor(businessId);
    if (!session) return errorResponse('NOT_FOUND', 'That business does not exist.');
    sessionStorage.setItem(SESSION_KEY, businessId);
    return HttpResponse.json(session, { status: 201 });
  }),

  http.delete(paths.session(), () => {
    sessionStorage.removeItem(SESSION_KEY);
    return new HttpResponse(null, { status: 204 });
  }),
];
