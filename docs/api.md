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
- **`paths`** builds URLs (`paths.planItem(planId, itemId)`); **`webPaths`** names the SPA routes the server hands out: `offerPage(token)` for the public offer page, and `vaultReturn()` / `vaultCancel()` for the pages PayPal returns a person to after saving a PayPal method.

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

### Visibility on a shared deal

A deal is shared by the supplier (the owner) and its client, but each side's policy is its own.
The server enforces this in every view, audit entry and live event (CR-4):

- **Both sides see:** the deal's state, terms and round; the negotiation messages and their notes
  (notes carry terms only, never an agent's reasons); PayPal's steps; and `closedReason`, which is
  always the public text.
- **History reasons:** a move whose real reason comes from one side's policy carries a neutral
  public reason (`Countered`, `Declined`, `Approved`, `Waiting for the supplier`, `Withdrawn by the
supplier`). The side that made the move reads the real reason in `DealDetail.history` and its
  audit trail, for example "A counter at 1.20% costs $1.00 over the $60.00 ceiling" for the owner,
  or "1.50% reaches our 23.00% target" for the client. A person's own words on the offer page
  ("Can pay $1,000.00 early", "Not now, thanks") are public.
- **Policy checks:** `NegotiationMessage.policyChecks` is filled only on messages from the viewer's
  own side; the other side's messages show `[]`. `NEGOTIATION_MESSAGE` audit entries carry
  `details.policyChecks` for the sender only.
- **Approvals:** an approval is seen only by the business it is addressed to: `COUNTER_OVER_PLAN`
  by the owner, `CLIENT_PAYMENT` by the client. That covers `DealDetail.approvals`,
  `pendingApprovalId` (null for the other side), the approval's audit entries and
  `approval.decided`. While a person at the client decides a payment, the owner's audit trail
  says only "Waiting for a person at {client} to approve the payment".
- **Client-only data:** the client's policy, its saved PayPal method and its approvals never reach
  the owner.

## Changelog

- **contracts-v3** (2026-11-10), from Developer B's CR-4:
  - `webPaths.vaultReturn()` (`/client/vault/return`) and `webPaths.vaultCancel()`
    (`/client/vault/cancel`), the pages PayPal returns a person to after saving, or not saving, a
    PayPal method. The vault service builds its PayPal return and cancel URLs from them, and the
    server serves the web app for both.
  - No page for `paypalApprovalUrl`: it is PayPal's invoice page, which never returns to Terms.
    Open it in a new tab and wait for `deal.updated`; the comment on
    `DecideApprovalResponse.paypalApprovalUrl` says so.
  - Who sees what on a shared deal is now enforced by the server (see "Visibility on a shared
    deal" above). The schemas say so: `DealSummary.pendingApprovalId` is only the approval the
    viewing business may decide (null otherwise), `DealSummary.closedReason` is the public reason
    both sides read, `DealTransition.reason` is the real reason only for the side that made the
    move, and `NegotiationMessage.policyChecks` is filled only for the sender's side. No shape
    changes.
  - `CONTRACTS_VERSION` is 3.
- **contracts-v2** (2026-11-10), from Developer B's contract requests:
  - CR-1: `PlanItemView.policyChecks`, the checks the server ran on the row when it was planned or
    last edited. Do-not-contact rows carry one blocked `doNotContact` check; other NONE rows are
    empty.
  - CR-2: `AuditEntry.paypalCall` (e.g. `PUT /v2/invoicing/invoices/{id}`, null when the entry
    records no PayPal call) and `AuditEntry.dealId` (the deal the entry belongs to, whatever its
    subject type); `ListAuditQuery.dealId` filters by deal.
  - `CONTRACTS_VERSION` is 2.
- **contracts-v1** (2026-11-09): first version.
