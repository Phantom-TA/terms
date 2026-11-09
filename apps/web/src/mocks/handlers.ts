import {
  type ApiErrorBody,
  CreateGoalRequest,
  type DealDetail,
  type ErrorCode,
  ERROR_HTTP_STATUS,
  endpoints,
  type PolicyCheckView,
  UpdateGoalRequest,
  UpdatePlanItemRequest,
  ApprovePlanRequest,
} from '@terms/shared';
import { http, HttpResponse } from 'msw';
import { businesses, health, sessionFor } from './fixtures';
import { MockWorld, PolicyBlockedError, SUPPLIER_POLICY } from './world';

const SESSION_KEY = 'terms.mock.session';
/** Set this sessionStorage key to fail matching API calls, for error-state tests. */
export const MOCK_FAILURE_KEY = 'terms.mock.fail';

let world = new MockWorld();
/** Gives a test (or a page reload) a fresh demo scenario. */
export function resetWorld(): MockWorld {
  world = new MockWorld();
  return world;
}
export function currentWorld(): MockWorld {
  return world;
}

function errorResponse(
  code: ErrorCode,
  message: string,
  extra: { retryable?: boolean; policyChecks?: PolicyCheckView[] } = {},
) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      retryable: extra.retryable ?? false,
      ...(extra.policyChecks ? { policyChecks: extra.policyChecks } : {}),
    },
  };
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

/** Owner routes need a session as the supplier, as on the real API. */
function ownerGuard() {
  const id = sessionStorage.getItem(SESSION_KEY);
  const session = id === null ? null : sessionFor(id);
  if (!session) return errorResponse('UNAUTHENTICATED', 'No demo session.');
  if (session.business.role !== 'SUPPLIER') {
    return errorResponse('FORBIDDEN', 'Only the owner can do this.');
  }
  return null;
}

const MISSING_GOAL = () => errorResponse('NOT_FOUND', 'There is no goal yet.');
const MISSING_PLAN = () => errorResponse('NOT_FOUND', 'There is no plan yet.');

export const handlers = [
  http.get(endpoints.health.path, () => HttpResponse.json(health)),

  http.get(endpoints.listBusinesses.path, () => {
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json({ businesses });
  }),

  http.get(endpoints.getSession.path, () => {
    if (shouldFail()) return paypalFailure();
    const id = sessionStorage.getItem(SESSION_KEY);
    const session = id === null ? null : sessionFor(id);
    return session
      ? HttpResponse.json(session)
      : errorResponse('UNAUTHENTICATED', 'No demo session.');
  }),

  http.post(endpoints.createSession.path, async ({ request }) => {
    const { businessId } = (await request.json()) as { businessId: string };
    const session = sessionFor(businessId);
    if (!session) return errorResponse('NOT_FOUND', 'That business does not exist.');
    sessionStorage.setItem(SESSION_KEY, businessId);
    return HttpResponse.json(session, { status: 201 });
  }),

  http.delete(endpoints.deleteSession.path, () => {
    sessionStorage.removeItem(SESSION_KEY);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(endpoints.currentGoal.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json(world.currentGoal());
  }),

  http.post(endpoints.createGoal.path, async ({ request }) => {
    const denied = ownerGuard();
    if (denied) return denied;
    const body = CreateGoalRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', 'Write what you need in a sentence.');
    return HttpResponse.json({ goal: world.parseGoal(body.data.text) }, { status: 201 });
  }),

  http.patch(endpoints.updateGoal.path, async ({ request }) => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (!world.goal) return MISSING_GOAL();
    const body = UpdateGoalRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid');
    return HttpResponse.json({ goal: world.updateGoal(body.data) });
  }),

  http.post(endpoints.createPlan.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (!world.goal) return MISSING_GOAL();
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json({ plan: world.createPlan() }, { status: 201 });
  }),

  http.get(endpoints.getPlan.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    return world.plan ? HttpResponse.json({ plan: world.plan }) : MISSING_PLAN();
  }),

  http.patch(endpoints.updatePlanItem.path, async ({ request, params }) => {
    const denied = ownerGuard();
    if (denied) return denied;
    const body = UpdatePlanItemRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid');
    try {
      return HttpResponse.json(world.updateItem(String(params['itemId']), body.data));
    } catch (error) {
      if (error instanceof PolicyBlockedError) {
        return errorResponse('POLICY_BLOCKED', 'That change is blocked by your policy.', {
          policyChecks: error.checks,
        });
      }
      return errorResponse(
        'CONFLICT',
        error instanceof Error ? error.message : 'Cannot edit this plan.',
      );
    }
  }),

  http.post(endpoints.approvePlan.path, async ({ request }) => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (!world.plan) return MISSING_PLAN();
    if (shouldFail()) return paypalFailure();
    const body = ApprovePlanRequest.safeParse(await request.json());
    if (!body.success) return errorResponse('VALIDATION_FAILED', 'Set a cost ceiling.');
    return HttpResponse.json({ plan: world.approve(body.data.costCeiling) });
  }),

  http.get(endpoints.listInvoices.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json({
      rows: world.invoiceRows(),
      planId: world.plan?.id ?? null,
      today: '2026-11-09',
      lastSyncedAt: '2026-11-09T09:55:00Z',
      demo: true,
    });
  }),

  http.get(endpoints.getRunway.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json(world.runway());
  }),

  http.get(endpoints.getSupplierPolicy.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    return HttpResponse.json({ policy: SUPPLIER_POLICY });
  }),

  http.get(endpoints.listDeals.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    return HttpResponse.json({
      planId: world.plan?.id ?? null,
      deals: [...world.deals.values()],
    });
  }),

  http.get(endpoints.getDeal.path, ({ params }) => {
    const deal = [...world.deals.values()].find((d) => d.id === params['dealId']);
    if (!deal) return errorResponse('NOT_FOUND', 'That deal does not exist.');
    const detail: DealDetail = {
      ...deal,
      paypal: {
        invoiceId: `INV2-${deal.invoiceNumber}-SBOX-0000-0000`,
        reissuedInvoiceId: null,
        orderId: null,
        captureId: null,
        invoicePaymentId: null,
        payerUrl: null,
      },
      messages: [],
      history: [
        {
          from: null,
          to: 'SUGGESTED',
          actor: 'SYSTEM',
          reason: 'Added to the plan.',
          at: deal.updatedAt,
        },
      ],
      approvals: [],
    };
    return HttpResponse.json(detail);
  }),
];
