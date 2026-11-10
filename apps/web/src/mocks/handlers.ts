import {
  type ApiErrorBody,
  type BusinessSummary,
  CreateGoalRequest,
  ListAuditQuery,
  ListClientOffersQuery,
  OfferReplyRequest,
  PutClientPolicyRequest,
  PutSupplierPolicyRequest,
  StudioTurnRequest,
  VaultConfirmRequest,
  DecideApprovalRequest,
  type ServerEvent,
  type ErrorCode,
  ERROR_HTTP_STATUS,
  endpoints,
  type PolicyCheckView,
  UpdateGoalRequest,
  UpdatePlanItemRequest,
  ApprovePlanRequest,
} from '@terms/shared';
import { delay, http, HttpResponse } from 'msw';
import { businesses, health, sessionFor } from './fixtures';
import { DeskValidationError, MockDesk, TokenError } from './desk';
import { mockStudioTurn } from './studio';
import { MockWorld, PolicyBlockedError, ShapeError } from './world';

const SESSION_KEY = 'terms.mock.session';
/** Set this sessionStorage key to a number of ms to slow plan edits down, for overlap tests. */
export const MOCK_SLOW_EDIT_KEY = 'terms.mock.slowEdit';
/** Set this sessionStorage key to fail matching API calls, for error-state tests. */
export const MOCK_FAILURE_KEY = 'terms.mock.fail';

let world = new MockWorld();
let desk = new MockDesk(() => world);

/** Set by the browser mock, which is the only place with an event stream to push to. */
export const mockHooks: {
  emit?: (events: ServerEvent[]) => void;
  onPlanApproved?: () => void;
} = {};

/** Gives a test (or a page reload) a fresh demo scenario. */
export function resetWorld(): MockWorld {
  world = new MockWorld();
  desk = new MockDesk(() => world);
  return world;
}
export function currentWorld(): MockWorld {
  return world;
}
export function currentDesk(): MockDesk {
  return desk;
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

export function sessionBusiness(): BusinessSummary | null {
  const id = sessionStorage.getItem(SESSION_KEY);
  return id === null ? null : (sessionFor(id)?.business ?? null);
}

/** Client routes need a session as a client, as on the real API. */
function clientGuard(): { business: BusinessSummary } | { denied: Response } {
  const business = sessionBusiness();
  if (!business) return { denied: errorResponse('UNAUTHENTICATED', 'No demo session.') };
  if (business.role !== 'CLIENT') {
    return { denied: errorResponse('FORBIDDEN', 'Only a client can do this.') };
  }
  return { business };
}

/** Runs a desk call, answering its refusals as the API would rather than as a network failure. */
function fromDesk(run: () => Response): Response {
  try {
    return run();
  } catch (error) {
    return deskError(error);
  }
}

function deskError(error: unknown) {
  if (error instanceof TokenError) return errorResponse('TOKEN_INVALID', error.message);
  if (error instanceof DeskValidationError)
    return errorResponse('VALIDATION_FAILED', error.message);
  return errorResponse(
    'CONFLICT',
    error instanceof Error ? error.message : 'That can’t be done now.',
  );
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

  http.post(endpoints.studioTurn.path, async ({ request }) => {
    const denied = ownerGuard();
    if (denied) return denied;
    const body = StudioTurnRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid turn');
    return HttpResponse.json(mockStudioTurn(body.data, world.runway()));
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
    const slow = Number(sessionStorage.getItem(MOCK_SLOW_EDIT_KEY) ?? 0);
    if (slow > 0) await delay(slow);
    try {
      return HttpResponse.json(world.updateItem(String(params['itemId']), body.data));
    } catch (error) {
      if (error instanceof ShapeError) {
        return errorResponse('VALIDATION_FAILED', error.message);
      }
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
    const plan = world.approve(body.data.costCeiling);
    mockHooks.onPlanApproved?.();
    return HttpResponse.json({ plan });
  }),

  http.get(endpoints.listInvoices.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json({
      rows: world
        .invoiceRows()
        .map((r) => (r.deal ? { ...r, deal: desk.summaryFor(r.deal, 'SUPPLIER') } : r)),
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
    return HttpResponse.json({ policy: desk.supplierPolicy });
  }),

  http.get(endpoints.listDeals.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    return HttpResponse.json({
      planId: world.plan?.id ?? null,
      deals: [...world.deals.values()].map((d) => desk.summaryFor(d, 'SUPPLIER')),
    });
  }),

  http.get(endpoints.getDeal.path, ({ params, request }) => {
    const business = sessionBusiness();
    if (!business) return errorResponse('UNAUTHENTICATED', 'No demo session.');
    const detail = world.dealDetail(String(params['dealId']));
    // A client sees only its own deals, and each side only its own checks, reasons and approvals.
    if (!detail || (business.role === 'CLIENT' && detail.client.id !== business.id))
      return errorResponse('NOT_FOUND', 'That deal does not exist.');
    // A payment approved without a saved method is paid on PayPal's invoice page. The link, and
    // whether the client has a saved method at all, are the client's own.
    const approved = detail.approvals.find(
      (a) => a.type === 'CLIENT_PAYMENT' && a.decision === 'APPROVED',
    );
    const payerUrl =
      business.role === 'CLIENT' && detail.state === 'AWAITING_PAYMENT' && approved
        ? desk.paymentApprovalUrl(approved, detail.client.id, new URL(request.url).origin)
        : null;
    return HttpResponse.json(
      desk.dealFor({ ...detail, paypal: { ...detail.paypal, payerUrl } }, business.role),
    );
  }),

  http.get(endpoints.listAudit.path, ({ request }) => {
    const business = sessionBusiness();
    if (!business) return errorResponse('UNAUTHENTICATED', 'No demo session.');
    if (shouldFail()) return paypalFailure();
    const query = ListAuditQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return errorResponse('VALIDATION_FAILED', 'Invalid audit filter.');
    return HttpResponse.json(desk.audit(business, query.data));
  }),

  http.get(endpoints.listApprovals.path, () => {
    const business = sessionBusiness();
    if (!business) return errorResponse('UNAUTHENTICATED', 'No demo session.');
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json({ approvals: desk.approvalsFor(business) });
  }),

  http.put(endpoints.putSupplierPolicy.path, async ({ request }) => {
    const denied = ownerGuard();
    if (denied) return denied;
    const body = PutSupplierPolicyRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid');
    return fromDesk(() => HttpResponse.json({ policy: desk.putSupplierPolicy(body.data) }));
  }),

  http.get(endpoints.getClientPolicy.path, () => {
    const session = clientGuard();
    if ('denied' in session) return session.denied;
    if (shouldFail()) return paypalFailure();
    try {
      return HttpResponse.json({ policy: desk.clientPolicy(session.business.id) });
    } catch (error) {
      return deskError(error);
    }
  }),

  http.put(endpoints.putClientPolicy.path, async ({ request }) => {
    const session = clientGuard();
    if ('denied' in session) return session.denied;
    const body = PutClientPolicyRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid');
    return fromDesk(() =>
      HttpResponse.json({ policy: desk.putClientPolicy(session.business.id, body.data) }),
    );
  }),

  http.get(endpoints.listClientOffers.path, ({ request }) => {
    const session = clientGuard();
    if ('denied' in session) return session.denied;
    if (shouldFail()) return paypalFailure();
    const query = ListClientOffersQuery.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) return errorResponse('VALIDATION_FAILED', 'Invalid offer filter.');
    return fromDesk(() =>
      HttpResponse.json({
        offers: desk.clientOffers(session.business.id, query.data.status),
        cashPosition: desk.cashPosition(session.business.id),
      }),
    );
  }),

  http.get(endpoints.getClientVault.path, () => {
    const session = clientGuard();
    if ('denied' in session) return session.denied;
    return fromDesk(() => HttpResponse.json({ vault: desk.vault(session.business.id) }));
  }),

  http.post(endpoints.clientVaultSetup.path, ({ request }) => {
    const session = clientGuard();
    if ('denied' in session) return session.denied;
    if (shouldFail()) return paypalFailure();
    return fromDesk(() =>
      HttpResponse.json(desk.setupVault(session.business.id, new URL(request.url).origin), {
        status: 201,
      }),
    );
  }),

  http.post(endpoints.clientVaultConfirm.path, async ({ request }) => {
    const session = clientGuard();
    if ('denied' in session) return session.denied;
    const body = VaultConfirmRequest.safeParse(await request.json());
    if (!body.success) return errorResponse('VALIDATION_FAILED', 'Missing the PayPal approval.');
    try {
      return HttpResponse.json({
        vault: desk.confirmVault(session.business.id, body.data.setupTokenId),
      });
    } catch (error) {
      return deskError(error);
    }
  }),

  http.get(endpoints.getConnection.path, () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (shouldFail()) return paypalFailure();
    return HttpResponse.json(desk.connection());
  }),

  http.post(endpoints.sync.path, async () => {
    const denied = ownerGuard();
    if (denied) return denied;
    if (shouldFail()) return paypalFailure();
    const slow = Number(sessionStorage.getItem(MOCK_SLOW_EDIT_KEY) ?? 0);
    if (slow > 0) await delay(slow);
    const { sync, events } = desk.sync();
    mockHooks.emit?.(events);
    return HttpResponse.json(sync);
  }),

  http.get(endpoints.getPublicOffer.path, ({ params }) => {
    if (shouldFail()) return paypalFailure();
    try {
      return HttpResponse.json({ offer: desk.offer(String(params['token'])) });
    } catch (error) {
      return deskError(error);
    }
  }),

  http.post(endpoints.replyPublicOffer.path, async ({ request, params }) => {
    const body = OfferReplyRequest.safeParse(await request.json());
    if (!body.success)
      return errorResponse('VALIDATION_FAILED', body.error.issues[0]?.message ?? 'Invalid');
    try {
      return HttpResponse.json(desk.reply(String(params['token']), body.data));
    } catch (error) {
      return deskError(error);
    }
  }),

  http.post(endpoints.decideApproval.path, async ({ request, params }) => {
    const business = sessionBusiness();
    if (!business) return errorResponse('UNAUTHENTICATED', 'No demo session.');
    const target = desk.approvalsFor(business).find((a) => a.id === params['approvalId']);
    if (!target) return errorResponse('NOT_FOUND', 'That approval is not yours to decide.');
    if (shouldFail()) return paypalFailure();
    const body = DecideApprovalRequest.safeParse(await request.json());
    if (!body.success) return errorResponse('VALIDATION_FAILED', 'Choose approve or reject.');
    try {
      const { approval, events } = world.decideApproval(
        String(params['approvalId']),
        body.data.decision,
        body.data.note ?? null,
      );
      const paying = approval.type === 'CLIENT_PAYMENT' && approval.decision === 'APPROVED';
      const paypalApprovalUrl = paying
        ? desk.paymentApprovalUrl(approval, business.id, new URL(request.url).origin)
        : null;
      // With a saved method the agent pays at once, and PayPal's webhook confirms it.
      if (paying && paypalApprovalUrl === null && approval.dealId) {
        if (world.dealDetail(approval.dealId)?.state === 'AWAITING_PAYMENT')
          events.push(...world.confirmPayment(approval.dealId));
      }
      mockHooks.emit?.(events);
      return HttpResponse.json({ approval, paypalApprovalUrl });
    } catch (error) {
      return errorResponse('CONFLICT', error instanceof Error ? error.message : 'Already decided.');
    }
  }),
];
