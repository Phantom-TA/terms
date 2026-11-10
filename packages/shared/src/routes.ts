/**
 * Every HTTP route, with its method, path, who may call it, and its request and response schemas.
 * The API registers its handlers from this table; the web app builds URLs with `paths`.
 */
import { type z } from 'zod';
import {
  DecideApprovalRequest,
  DecideApprovalResponse,
  ListApprovalsQuery,
  ListApprovalsResponse,
} from './schemas/approvals.js';
import { ListAuditQuery, ListAuditResponse } from './schemas/audit.js';
import {
  ListClientOffersQuery,
  ListClientOffersResponse,
  VaultConfirmRequest,
  VaultResponse,
  VaultSetupRequest,
  VaultSetupResponse,
} from './schemas/client.js';
import { DealDetail, ListDealsQuery, ListDealsResponse } from './schemas/deals.js';
import {
  CreateGoalRequest,
  CurrentGoalResponse,
  GoalResponse,
  UpdateGoalRequest,
} from './schemas/goals.js';
import { ListInvoicesQuery, ListInvoicesResponse } from './schemas/invoices.js';
import {
  OfferReplyRequest,
  OfferReplyResponse,
  PublicOfferResponse,
} from './schemas/offer-page.js';
import {
  ApprovePlanRequest,
  CreatePlanRequest,
  PlanResponse,
  UpdatePlanItemRequest,
  UpdatePlanItemResponse,
} from './schemas/plans.js';
import {
  ClientPolicyResponse,
  PutClientPolicyRequest,
  PutSupplierPolicyRequest,
  SupplierPolicyResponse,
} from './schemas/policies.js';
import { RunwayQuery, RunwayResponse } from './schemas/runway.js';
import {
  CreateSessionRequest,
  HealthResponse,
  ListBusinessesResponse,
  SessionResponse,
} from './schemas/session.js';
import { StudioTurnRequest, StudioTurnResponse } from './schemas/studio.js';
import { ConnectionResponse, SyncRequest, SyncResponse } from './schemas/sync.js';
import { PayPalWebhookEnvelope, WebhookAckResponse } from './schemas/webhooks.js';

const enc = encodeURIComponent;

/** URL builders for every route. */
export const paths = {
  health: () => '/api/health',
  businesses: () => '/api/businesses',
  session: () => '/api/session',
  connection: () => '/api/connection',
  sync: () => '/api/sync',
  invoices: () => '/api/invoices',
  runway: () => '/api/runway',
  goals: () => '/api/goals',
  currentGoal: () => '/api/goals/current',
  goal: (goalId: string) => `/api/goals/${enc(goalId)}`,
  goalPlan: (goalId: string) => `/api/goals/${enc(goalId)}/plan`,
  plan: (planId: string) => `/api/plans/${enc(planId)}`,
  planItem: (planId: string, itemId: string) => `/api/plans/${enc(planId)}/items/${enc(itemId)}`,
  planApprove: (planId: string) => `/api/plans/${enc(planId)}/approve`,
  deals: () => '/api/deals',
  deal: (dealId: string) => `/api/deals/${enc(dealId)}`,
  approvals: () => '/api/approvals',
  approval: (approvalId: string) => `/api/approvals/${enc(approvalId)}`,
  supplierPolicy: () => '/api/supplier/policy',
  clientOffers: () => '/api/client/offers',
  clientPolicy: () => '/api/client/policy',
  clientVault: () => '/api/client/vault',
  clientVaultSetup: () => '/api/client/vault/setup',
  clientVaultConfirm: () => '/api/client/vault/confirm',
  publicOffer: (token: string) => `/api/offer/${enc(token)}`,
  publicOfferReply: (token: string) => `/api/offer/${enc(token)}/reply`,
  paypalWebhook: () => '/api/webhooks/paypal',
  audit: () => '/api/audit',
  studioTurn: () => '/api/studio/turn',
  stream: () => '/api/stream',
} as const;

/** SPA routes that are not API routes (the server serves index.html for them). */
export const webPaths = {
  offerPage: (token: string) => `/offer/${enc(token)}`,
  /** Where PayPal returns a client's person after approving the saved PayPal method. */
  vaultReturn: () => '/client/vault/return',
  /** Where PayPal returns a client's person who cancelled saving the PayPal method. */
  vaultCancel: () => '/client/vault/cancel',
} as const;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * PUBLIC: no session; OWNER: a session as the supplier; CLIENT: a session as a client business;
 * SESSION: either; OFFER_TOKEN: a signed offer token in the path; PAYPAL: PayPal webhook signature.
 */
export type RouteAuth = 'PUBLIC' | 'OWNER' | 'CLIENT' | 'SESSION' | 'OFFER_TOKEN' | 'PAYPAL';

export interface EndpointDef {
  method: HttpMethod;
  /** Express-style path pattern. */
  path: string;
  auth: RouteAuth;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Success response body; null for 204 or a streamed response. */
  response: z.ZodType | null;
  /** HTTP status on success. */
  status: 200 | 201 | 202 | 204;
  summary: string;
}

function def<const D extends EndpointDef>(d: D): D {
  return d;
}

export const endpoints = {
  health: def({
    method: 'GET',
    path: '/api/health',
    auth: 'PUBLIC',
    response: HealthResponse,
    status: 200,
    summary: 'Liveness, database and configuration status',
  }),
  listBusinesses: def({
    method: 'GET',
    path: '/api/businesses',
    auth: 'PUBLIC',
    response: ListBusinessesResponse,
    status: 200,
    summary: 'Businesses a demo visitor can act as',
  }),
  getSession: def({
    method: 'GET',
    path: '/api/session',
    auth: 'SESSION',
    response: SessionResponse,
    status: 200,
    summary: 'Current demo session',
  }),
  createSession: def({
    method: 'POST',
    path: '/api/session',
    auth: 'PUBLIC',
    body: CreateSessionRequest,
    response: SessionResponse,
    status: 201,
    summary: 'Start a demo session as one business (httpOnly cookie)',
  }),
  deleteSession: def({
    method: 'DELETE',
    path: '/api/session',
    auth: 'SESSION',
    response: null,
    status: 204,
    summary: 'End the demo session',
  }),
  getConnection: def({
    method: 'GET',
    path: '/api/connection',
    auth: 'OWNER',
    response: ConnectionResponse,
    status: 200,
    summary: 'PayPal connection, counts and balance for the Connect screen',
  }),
  sync: def({
    method: 'POST',
    path: '/api/sync',
    auth: 'OWNER',
    body: SyncRequest,
    response: SyncResponse,
    status: 200,
    summary: 'Import invoices, transactions and balance from PayPal',
  }),
  listInvoices: def({
    method: 'GET',
    path: '/api/invoices',
    auth: 'OWNER',
    query: ListInvoicesQuery,
    response: ListInvoicesResponse,
    status: 200,
    summary: 'Workbench rows',
  }),
  getRunway: def({
    method: 'GET',
    path: '/api/runway',
    auth: 'OWNER',
    query: RunwayQuery,
    response: RunwayResponse,
    status: 200,
    summary: 'Cash runway before and after the plan',
  }),
  createGoal: def({
    method: 'POST',
    path: '/api/goals',
    auth: 'OWNER',
    body: CreateGoalRequest,
    response: GoalResponse,
    status: 201,
    summary: "Parse the owner's sentence into a goal for confirmation",
  }),
  currentGoal: def({
    method: 'GET',
    path: '/api/goals/current',
    auth: 'OWNER',
    response: CurrentGoalResponse,
    status: 200,
    summary: 'Latest active goal and its latest plan',
  }),
  getGoal: def({
    method: 'GET',
    path: '/api/goals/:goalId',
    auth: 'OWNER',
    response: GoalResponse,
    status: 200,
    summary: 'One goal',
  }),
  updateGoal: def({
    method: 'PATCH',
    path: '/api/goals/:goalId',
    auth: 'OWNER',
    body: UpdateGoalRequest,
    response: GoalResponse,
    status: 200,
    summary: 'Owner edits parsed goal fields',
  }),
  createPlan: def({
    method: 'POST',
    path: '/api/goals/:goalId/plan',
    auth: 'OWNER',
    body: CreatePlanRequest,
    response: PlanResponse,
    status: 201,
    summary: 'Run the planner; returns the plan with reasons',
  }),
  getPlan: def({
    method: 'GET',
    path: '/api/plans/:planId',
    auth: 'OWNER',
    response: PlanResponse,
    status: 200,
    summary: 'One plan with its rows',
  }),
  updatePlanItem: def({
    method: 'PATCH',
    path: '/api/plans/:planId/items/:itemId',
    auth: 'OWNER',
    body: UpdatePlanItemRequest,
    response: UpdatePlanItemResponse,
    status: 200,
    summary: 'Owner edits a row (validated against policy)',
  }),
  approvePlan: def({
    method: 'POST',
    path: '/api/plans/:planId/approve',
    auth: 'OWNER',
    body: ApprovePlanRequest,
    response: PlanResponse,
    status: 200,
    summary: 'Approve the plan and its cost ceiling; starts execution',
  }),
  listDeals: def({
    method: 'GET',
    path: '/api/deals',
    auth: 'OWNER',
    query: ListDealsQuery,
    response: ListDealsResponse,
    status: 200,
    summary: "Deals in the owner's plan",
  }),
  getDeal: def({
    method: 'GET',
    path: '/api/deals/:dealId',
    auth: 'SESSION',
    response: DealDetail,
    status: 200,
    summary: 'Deal state and transcript (owner, or the deal’s client)',
  }),
  listApprovals: def({
    method: 'GET',
    path: '/api/approvals',
    auth: 'SESSION',
    query: ListApprovalsQuery,
    response: ListApprovalsResponse,
    status: 200,
    summary: 'Approvals addressed to the session’s business',
  }),
  decideApproval: def({
    method: 'POST',
    path: '/api/approvals/:approvalId',
    auth: 'SESSION',
    body: DecideApprovalRequest,
    response: DecideApprovalResponse,
    status: 200,
    summary: 'Approve or reject',
  }),
  getSupplierPolicy: def({
    method: 'GET',
    path: '/api/supplier/policy',
    auth: 'OWNER',
    response: SupplierPolicyResponse,
    status: 200,
    summary: "The owner's standing policy",
  }),
  putSupplierPolicy: def({
    method: 'PUT',
    path: '/api/supplier/policy',
    auth: 'OWNER',
    body: PutSupplierPolicyRequest,
    response: SupplierPolicyResponse,
    status: 200,
    summary: "Replace the owner's policy",
  }),
  listClientOffers: def({
    method: 'GET',
    path: '/api/client/offers',
    auth: 'CLIENT',
    query: ListClientOffersQuery,
    response: ListClientOffersResponse,
    status: 200,
    summary: 'Incoming offers ranked by annualised return',
  }),
  getClientPolicy: def({
    method: 'GET',
    path: '/api/client/policy',
    auth: 'CLIENT',
    response: ClientPolicyResponse,
    status: 200,
    summary: "The client agent's policy",
  }),
  putClientPolicy: def({
    method: 'PUT',
    path: '/api/client/policy',
    auth: 'CLIENT',
    body: PutClientPolicyRequest,
    response: ClientPolicyResponse,
    status: 200,
    summary: "Replace the client agent's policy",
  }),
  getClientVault: def({
    method: 'GET',
    path: '/api/client/vault',
    auth: 'CLIENT',
    response: VaultResponse,
    status: 200,
    summary: 'Saved PayPal method status',
  }),
  clientVaultSetup: def({
    method: 'POST',
    path: '/api/client/vault/setup',
    auth: 'CLIENT',
    body: VaultSetupRequest,
    response: VaultSetupResponse,
    status: 201,
    summary: "Start saving the client's PayPal method",
  }),
  clientVaultConfirm: def({
    method: 'POST',
    path: '/api/client/vault/confirm',
    auth: 'CLIENT',
    body: VaultConfirmRequest,
    response: VaultResponse,
    status: 200,
    summary: 'Finish saving the PayPal method after PayPal approval',
  }),
  getPublicOffer: def({
    method: 'GET',
    path: '/api/offer/:token',
    auth: 'OFFER_TOKEN',
    response: PublicOfferResponse,
    status: 200,
    summary: 'Offer page data for a human client',
  }),
  replyPublicOffer: def({
    method: 'POST',
    path: '/api/offer/:token/reply',
    auth: 'OFFER_TOKEN',
    body: OfferReplyRequest,
    response: OfferReplyResponse,
    status: 200,
    summary: 'Button or free-text reply from a human client',
  }),
  paypalWebhook: def({
    method: 'POST',
    path: '/api/webhooks/paypal',
    auth: 'PAYPAL',
    body: PayPalWebhookEnvelope,
    response: WebhookAckResponse,
    status: 200,
    summary: 'Receive, verify, store and process a PayPal event',
  }),
  listAudit: def({
    method: 'GET',
    path: '/api/audit',
    auth: 'SESSION',
    query: ListAuditQuery,
    response: ListAuditResponse,
    status: 200,
    summary: 'Audit trail, newest first',
  }),
  studioTurn: def({
    method: 'POST',
    path: '/api/studio/turn',
    auth: 'OWNER',
    body: StudioTurnRequest,
    response: StudioTurnResponse,
    status: 200,
    summary: 'One rate-limited turn of the AG Studio cash strategist',
  }),
  stream: def({
    method: 'GET',
    path: '/api/stream',
    auth: 'SESSION',
    response: null,
    status: 200,
    summary: 'Server-sent events (see ServerEvent)',
  }),
} as const satisfies Record<string, EndpointDef>;

export type EndpointName = keyof typeof endpoints;
