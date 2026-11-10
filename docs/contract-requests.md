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

**Status:** answered by A. `webPaths.vaultReturn` and `vaultCancel` are coming in `contracts-v3`; the server already serves the app for them. The web app uses its own constants until then.

1. A's vault service sends PayPal `${APP_BASE_URL}/client/vault/return` and `/client/vault/cancel`. The web app has both pages (the return page reads `approval_token_id`). A is adding them to `webPaths`:

```ts
// packages/shared/src/routes.ts, webPaths
vaultReturn: () => '/client/vault/return',
vaultCancel: () => '/client/vault/cancel',
```

2. Answered: no return page is needed for a payment. `paypalApprovalUrl` from `POST /api/approvals/:approvalId` is the PayPal invoice page, sent only when the client has no saved PayPal method. PayPal does not redirect back; Terms learns of the payment from the verified webhook and sends `deal.updated`. The web app opens it in a new tab and shows the payment as waiting for PayPal confirmation (W-037).

3. Answered: each side sees the negotiation messages, PayPal's steps and the deal's state changes; each sees only its own approvals, reasons and policy checks. A is fixing the server, which currently shows some of these to the other side, and will say when that is on `develop`. The web app and mock follow these rules (W-046).
