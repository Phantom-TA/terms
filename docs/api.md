# Terms API contracts

Contract version: **contracts-v1** (`CONTRACTS_VERSION = 1` in `@terms/shared`).

Every request, response, enum and event is defined once, as a zod schema, in `packages/shared` (`@terms/shared`). This document is a map of those schemas. When this file and the code disagree, the code wins.

## Using the contracts

```ts
import { endpoints, paths, PlanResponse, ServerEvent, formatMoney } from '@terms/shared';

const res = await fetch(paths.plan(planId), { credentials: 'include' });
const { plan } = PlanResponse.parse(await res.json());
```

- **Import, never redefine.** The web app imports types and schemas from `@terms/shared`. Contract changes are requested in `docs/contract-requests.md`; Developer A implements them and bumps the tag.
- **Source in development, build in production.** `@terms/shared` exports its TypeScript source under the `@terms/source` condition and compiled `dist/` otherwise. Add the condition so Vite and Vitest read source without a build step:
  - Vite / Vitest: `resolve: { conditions: ['@terms/source'] }`
  - tsconfig: extend `../../tsconfig.base.json` (it sets `customConditions`), or add `"customConditions": ["@terms/source"]`.
- **`endpoints`** is the route table: method, path pattern, auth, query, body and response schemas, success status. Mocks for `VITE_USE_MOCKS=true` can be generated from it.
- **`paths`** builds URLs (`paths.planItem(planId, itemId)`); **`webPaths.offerPage(token)`** is the SPA route for the public offer page.

## Conventions

| Topic         | Rule                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money         | Decimal string with exactly two decimals: `"1500.00"`, `"-11400.00"`. Never a number. Schemas: `Money` (signed), `MoneyAmount` (≥ 0), `PositiveMoney` (> 0). Display with `formatMoney()`.                                |
| Percent       | Two decimals: `"1.20"` (`Percent`). Annual rates have one decimal: `"18.5"` (`AnnualRate`).                                                                                                                               |
| Dates         | Calendar dates `YYYY-MM-DD` (`IsoDate`); instants ISO 8601 with offset (`IsoDateTime`).                                                                                                                                   |
| IDs           | Opaque strings. PayPal IDs are kept as PayPal returns them.                                                                                                                                                               |
| Errors        | Every non-2xx JSON response is `ApiErrorBody`: `{ error: { code, message, retryable, issues?, policyChecks?, paypal? } }`. `ERROR_HTTP_STATUS` maps codes to statuses. PayPal failures carry `paypal.debugId` for the UI. |
| Auth          | Demo session per business in an httpOnly cookie (`POST /api/session`). `OWNER` routes need the supplier's session, `CLIENT` routes a client's, `SESSION` either. The offer page uses a signed token in the path.          |
| Payment state | Read-only for clients of the API. Only verified PayPal webhooks or server-side PayPal reads move a deal to `PAID` / `PARTIALLY_PAID`.                                                                                     |
| Demo data     | `isDemo` on businesses and invoices; `demo` on session, connection and invoice list responses.                                                                                                                            |

## Endpoints

| Name (`endpoints.*`) | Method and path                          | Auth             | Request                       | Response                             |
| -------------------- | ---------------------------------------- | ---------------- | ----------------------------- | ------------------------------------ |
| health               | `GET /api/health`                        | public           | —                             | `HealthResponse`                     |
| listBusinesses       | `GET /api/businesses`                    | public           | —                             | `ListBusinessesResponse`             |
| getSession           | `GET /api/session`                       | session          | —                             | `SessionResponse`                    |
| createSession        | `POST /api/session`                      | public           | `CreateSessionRequest`        | `SessionResponse` (201)              |
| deleteSession        | `DELETE /api/session`                    | session          | —                             | 204                                  |
| getConnection        | `GET /api/connection`                    | owner            | —                             | `ConnectionResponse`                 |
| sync                 | `POST /api/sync`                         | owner            | `SyncRequest` (`{}`)          | `SyncResponse`                       |
| listInvoices         | `GET /api/invoices`                      | owner            | query `ListInvoicesQuery`     | `ListInvoicesResponse`               |
| getRunway            | `GET /api/runway`                        | owner            | query `RunwayQuery`           | `RunwayResponse`                     |
| createGoal           | `POST /api/goals`                        | owner            | `CreateGoalRequest`           | `GoalResponse` (201)                 |
| currentGoal          | `GET /api/goals/current`                 | owner            | —                             | `CurrentGoalResponse`                |
| getGoal              | `GET /api/goals/:goalId`                 | owner            | —                             | `GoalResponse`                       |
| updateGoal           | `PATCH /api/goals/:goalId`               | owner            | `UpdateGoalRequest`           | `GoalResponse`                       |
| createPlan           | `POST /api/goals/:goalId/plan`           | owner            | `CreatePlanRequest`           | `PlanResponse` (201)                 |
| getPlan              | `GET /api/plans/:planId`                 | owner            | —                             | `PlanResponse`                       |
| updatePlanItem       | `PATCH /api/plans/:planId/items/:itemId` | owner            | `UpdatePlanItemRequest`       | `UpdatePlanItemResponse`             |
| approvePlan          | `POST /api/plans/:planId/approve`        | owner            | `ApprovePlanRequest`          | `PlanResponse`                       |
| listDeals            | `GET /api/deals`                         | owner            | query `ListDealsQuery`        | `ListDealsResponse`                  |
| getDeal              | `GET /api/deals/:dealId`                 | session          | —                             | `DealDetail`                         |
| listApprovals        | `GET /api/approvals`                     | session          | query `ListApprovalsQuery`    | `ListApprovalsResponse`              |
| decideApproval       | `POST /api/approvals/:approvalId`        | session          | `DecideApprovalRequest`       | `DecideApprovalResponse`             |
| getSupplierPolicy    | `GET /api/supplier/policy`               | owner            | —                             | `SupplierPolicyResponse`             |
| putSupplierPolicy    | `PUT /api/supplier/policy`               | owner            | `PutSupplierPolicyRequest`    | `SupplierPolicyResponse`             |
| listClientOffers     | `GET /api/client/offers`                 | client           | query `ListClientOffersQuery` | `ListClientOffersResponse`           |
| getClientPolicy      | `GET /api/client/policy`                 | client           | —                             | `ClientPolicyResponse`               |
| putClientPolicy      | `PUT /api/client/policy`                 | client           | `PutClientPolicyRequest`      | `ClientPolicyResponse`               |
| getClientVault       | `GET /api/client/vault`                  | client           | —                             | `VaultResponse`                      |
| clientVaultSetup     | `POST /api/client/vault/setup`           | client           | `VaultSetupRequest` (`{}`)    | `VaultSetupResponse` (201)           |
| clientVaultConfirm   | `POST /api/client/vault/confirm`         | client           | `VaultConfirmRequest`         | `VaultResponse`                      |
| getPublicOffer       | `GET /api/offer/:token`                  | offer token      | —                             | `PublicOfferResponse`                |
| replyPublicOffer     | `POST /api/offer/:token/reply`           | offer token      | `OfferReplyRequest`           | `OfferReplyResponse`                 |
| paypalWebhook        | `POST /api/webhooks/paypal`              | PayPal signature | `PayPalWebhookEnvelope`       | `WebhookAckResponse`                 |
| listAudit            | `GET /api/audit`                         | session          | query `ListAuditQuery`        | `ListAuditResponse`                  |
| studioTurn           | `POST /api/studio/turn`                  | owner            | `StudioTurnRequest`           | `StudioTurnResponse`                 |
| stream               | `GET /api/stream`                        | session          | —                             | `text/event-stream` of `ServerEvent` |

Additions to the CONTEXT.md endpoint table: `health`, `businesses` and `session` (demo session per business), `connection` (Connect screen), `goals/current`, `GET goals/:id`, `GET plans/:id`, `GET deals`, supplier policy, `GET client/policy` and `GET client/vault`. The offer page JSON is under `/api/offer/:token` so it does not collide with the SPA route `/offer/:token` (see `docs/decisions-core.md`).

## Screens → data

| Screen                 | Load                                                    | Live updates (SSE)                                                              | Actions                                                                       |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Connect & import       | `getConnection`                                         | `sync.completed`                                                                | `sync`                                                                        |
| Goal bar               | `currentGoal`                                           | —                                                                               | `createGoal`, `updateGoal`, `createPlan`                                      |
| Workbench              | `listInvoices`, `currentGoal`, `getRunway`              | `invoice.updated`, `plan.updated`, `deal.updated`, `runway.updated`, `goal.met` | `updatePlanItem`, `approvePlan`                                               |
| Negotiation Room       | `listDeals`, `getDeal`                                  | `negotiation.message`, `deal.updated`, `approval.requested`                     | `decideApproval`                                                              |
| Approvals inbox        | `listApprovals`                                         | `approval.requested`, `approval.decided`                                        | `decideApproval`                                                              |
| Payables Desk (client) | `listClientOffers`, `getClientPolicy`, `getClientVault` | `deal.updated`, `negotiation.message`, `approval.requested`                     | `putClientPolicy`, `clientVaultSetup`, `clientVaultConfirm`, `decideApproval` |
| Offer page (public)    | `getPublicOffer`                                        | —                                                                               | `replyPublicOffer`                                                            |
| Cash Studio            | —                                                       | —                                                                               | `studioTurn`                                                                  |
| Audit trail            | `listAudit`                                             | `audit.appended`, `webhook.received`                                            | —                                                                             |
| Settings               | `getSupplierPolicy` or `getClientPolicy`, `getSession`  | —                                                                               | `putSupplierPolicy`, `putClientPolicy`                                        |

## Server-sent events

`GET /api/stream` sends frames `event: <type>`, `id: <id>`, `data: <ServerEvent JSON>`. Reconnects resume with `Last-Event-ID`. A heartbeat arrives every 20 s (`HEARTBEAT_INTERVAL_MS`). Each session receives only events about its own business. Types (`SERVER_EVENT_TYPES`): `invoice.updated`, `plan.updated`, `deal.updated`, `negotiation.message`, `approval.requested`, `approval.decided`, `goal.met`, `runway.updated`, `webhook.received`, `audit.appended`, `sync.completed`, `heartbeat`.

## Shared logic the UI may use

- **Money and rates:** `toCents`, `fromCents`, `formatMoney`, `normalizeMoneyInput`, `percentToBps`, `bpsToPercent`, `normalizePercentInput`, `discountOn`, `impliedAnnualRate`, `meetsAnnualRate`, `discountForAnnualRate`, `defaultOpeningBps`.
- **Deal states:** `DealState`, `DEAL_TRANSITIONS`, `isCommitted`, `isOpenOffer`, `isFinal`. Use these for pills and for which actions to show.
- **Policy checks:** `checkMaxDiscount`, `checkDoNotContact`, `evaluateSupplierTerms`, `evaluateClientOffer` and others. Use them to validate editable cells before sending. The server runs the same checks and is authoritative.

## AG Studio turn protocol

The browser runs the agent loop and calls `POST /api/studio/turn` with the message history and the AG Studio widget actions it exposes (`clientTools`, each with a JSON Schema). The server runs read-only data tools itself (`StudioServerTool`) and returns the assistant message plus any `toolCalls` for the browser to execute. The browser sends results back as `tool` messages and calls again until `done` is true. If AG Studio's agent interface needs a different shape, request it in `docs/contract-requests.md`.

## Server behaviour notes (for the web app)

These are what the API actually does, beyond the schemas (all routes are live on `a/core`):

- **Responses are checked against these schemas before they are sent.** A mismatch is a server bug
  (500), never a silent shape change.
- **Sessions:** `POST /api/session` sets an httpOnly cookie `terms_session` (12 hours). Send
  requests with credentials. Without one, a session route answers 401; with the wrong role, 403.
- **Live updates:** `GET /api/stream` sends each event as `id: <n>`, `event: <type>`,
  `data: <ServerEvent JSON>`.
  - A reconnect with `Last-Event-ID` (EventSource does this automatically) replays what was missed.
  - Heartbeats come every 20 s and carry no id.
  - `deal.updated` arrives after a change commits; `audit.appended` arrives for every audit entry
    the business may see.
- **Plan approval starts execution in the background.** Watch `deal.updated` and `plan.updated`.
  - Agents negotiate, and the owner may get a `COUNTER_OVER_PLAN` approval.
  - Agreed terms go onto the PayPal invoice; an agent pays from its saved method within its limit.
  - The stop rule withdraws open offers and sends `goal.met`.
- **Runway:** answers 409 `CONFLICT` until a sync has stored a PayPal balance (`POST /api/sync`).
- **Not yet available, answering 503 `NOT_CONFIGURED`:**
  - `POST /api/studio/turn`, until the AI agent exists;
  - offer-page `TEXT` replies, until the AI reply parser exists (D-022);
  - PayPal routes when PayPal credentials are missing.
- **Goals:** `POST /api/goals` uses the rule-based parser when no AI is configured (D-017). The
  response lists `defaultedFields` for the owner to confirm. A sentence without an amount answers 400.
- **Offer links for clients without an agent** are recorded in the audit trail as
  `details.offerUrl` (an entry whose summary starts "Offer link"). A forged or expired link answers
  410 `TOKEN_INVALID`. The offer routes are rate-limited (429 with `Retry-After`).
- **Approvals:** deciding a `CLIENT_PAYMENT` approval for a client without a saved PayPal method
  returns `paypalApprovalUrl`, the PayPal invoice the person pays.
- **PayPal webhooks:** a delivery that fails verification answers 401 and is still streamed to the
  owner as `webhook.received` with `verified: false`.

## Changelog

- **contracts-v2** (2026-11-10), from Developer B's contract requests:
  - CR-1: `PlanItemView.policyChecks`, the checks the server ran on the row when it was planned or
    last edited. Do-not-contact rows carry one blocked `doNotContact` check; other NONE rows are
    empty.
  - CR-2: `AuditEntry.paypalCall` (e.g. `PUT /v2/invoicing/invoices/{id}`, null when the entry
    records no PayPal call) and `AuditEntry.dealId` (the deal the entry belongs to, whatever its
    subject type); `ListAuditQuery.dealId` filters by deal.
  - `CONTRACTS_VERSION` is 2.
- **contracts-v1** (2026-11-09): first version.
