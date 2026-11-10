# Contract requests (Developer B to Developer A)

Open requests against `@terms/shared` and root tooling. Until each ships, the web app builds against what exists.

## CR-1: per-row policy checks on `PlanItemView`

**Status:** done in `contracts-v2`.

The Workbench shows policy badges on every row, but `PlanItemView` has no checks. `UpdatePlanItemResponse.policyChecks` only covers a row just edited. Computing them in the browser would show checks the server may not have run.

```ts
// packages/shared/src/schemas/plans.ts, PlanItemView
/** Checks the planner ran on this row. Empty for NONE rows with nothing to check. */
policyChecks: z.array(PolicyCheckView),
```

## CR-2: which PayPal call an audit entry records

**Status:** done in `contracts-v2`.

The Negotiation Room shows a chip naming the PayPal call behind each settlement step, from audit data. Today that is only inside the untyped `details` record, so the UI would have to guess its key. Settlement entries also need to be findable by deal.

```ts
// packages/shared/src/schemas/audit.ts, AuditEntry
/** The PayPal call this entry records, e.g. "PUT /v2/invoicing/invoices/{id}"; null otherwise. */
paypalCall: z.string().nullable(),
/** The deal this entry belongs to, when it has one, whatever its subject type. */
dealId: Id.nullable(),

// ListAuditQuery
dealId: Id.optional(),
```

## CR-3: run the web gate in CI (root tooling, not a contract)

**Status:** done on `develop`.

Add to `.github/workflows/ci.yml`, after "Test with coverage":

```yaml
- name: Web lint and component tests
  run: pnpm --filter @terms/web lint && pnpm --filter @terms/web test

- name: Web production build and bundle check
  run: pnpm --filter @terms/web exec vite build && node apps/web/scripts/check-prod-bundle.mjs
```

The Render build also needs `apps/web` built, with `dist` served by the API for non-`/api` routes, including `/offer/:token`.

## CR-4: the pages PayPal returns a client to, and who sees which audit entries

**Status:** closed. `contracts-v3` is on `develop` with `webPaths.vaultReturn` and `vaultCancel`, and the web app uses them. The server enforces the visibility rules, and `docs/api.md` ("Visibility on a shared deal") documents them.

1. A's vault service sends PayPal `${APP_BASE_URL}/client/vault/return` and `/client/vault/cancel`. The web app has both pages (the return page reads `approval_token_id`). A is adding them to `webPaths`:

```ts
// packages/shared/src/routes.ts, webPaths
vaultReturn: () => '/client/vault/return',
vaultCancel: () => '/client/vault/cancel',
```

2. Answered: no return page is needed for a payment. `paypalApprovalUrl` from `POST /api/approvals/:approvalId` is the PayPal invoice page, sent only when the client has no saved PayPal method. PayPal does not redirect back; Terms learns of the payment from the verified webhook and sends `deal.updated`. The web app opens it in a new tab and shows the payment as waiting for PayPal confirmation (W-037).

3. Done in `contracts-v3`: `DealSummary.pendingApprovalId` is documented as "Pending NEEDS_OWNER or client-payment approval". Under the rule in 3, the owner should get it only for its own approvals and a client only for its own; otherwise the owner's Workbench shows a client's payment approval as needing the owner. A's comment now says `pendingApprovalId` is only ever the viewing business's own approval. `closedReason` is the public text both sides read, and a side's private reason is in its own history (W-047).

4. Answered: each side sees the negotiation messages, PayPal's steps and the deal's state changes; each sees only its own approvals, reasons and policy checks. The server fix is on `develop`: a message's policy checks go only to the side that sent it, and the other side's moves carry a neutral reason. The web app and the mock follow the same rules (W-046, W-047).

## CR-5: charting a what-if in Cash Studio, and what the strategist's model is sent

**Status:** open. The web side is built and tested against a mock of `POST /api/studio/turn`.

1. **What-if figures can't be charted.** `simulate_discount_cap` runs on the server, and its result reaches only the model. Studio's widgets can chart only the tables the browser gave Studio, and the browser must not work out payment outcomes. So "What if I cap discounts at 1.0%?" can be answered in words but not drawn. A suggestion; please pick whichever suits the server:

```ts
// StudioTurnResponse, optional: the runway under the last what-if the server ran in this turn.
scenario: z.object({
  label: z.string(),            // e.g. "Discounts capped at 1.00%"
  points: z.array(RunwayPoint),  // same shape as GET /api/runway
}).nullable(),
```

The browser would keep a fixed `scenario` table in Studio and replace its rows when a turn carries one. Studio takes new rows for an existing table, but not new tables after it starts. The model could then chart `scenario.afterPlanned` against `runway.afterPlanned`.

2. **For the server's prompt: what the browser sends.** Nothing to change in the contract.

- **Client tools:** `view_schema`, `view_page`, `view_widget`, `execute_query`, `add_widget`, `position_widget`, `configure_line_chart`, `configure_column_chart` and `configure_value`. `view_widget`, `position_widget` and the configure tools are offered only once a widget exists.
- **Request size:** the schemas are large. `execute_query` alone is about 18 KB of JSON Schema with `$defs` and nested `anyOf`, so please check the request size limit on the route.
- **Building a widget takes two rounds:** `add_widget` (type and position on a 12-column page), then the matching configure tool with `op: "patch"` and a `dataMapping`. Widget types are Studio's catalogue IDs (`line-chart`, `column-chart-grouped`, `value`).
- **Fields:** IDs are `invoices.*` and `runway.*`. A date axis needs a grain, for example `runway.date::day`. Each table lists its fields in `view_schema`.
- **Tool results:** each comes back as a `tool` message whose `output` is Studio's `{ success, response, data }`.
