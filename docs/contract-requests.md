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

**Status:** open.

1. A's vault service sends PayPal `${APP_BASE_URL}/client/vault/return` and `/client/vault/cancel`. The web app has both pages (the return page reads `approval_token_id`), but they are not in `webPaths`, so the two sides could drift. The deployed server must also serve the app for these paths, as for `/offer/:token`.

```ts
// packages/shared/src/routes.ts, webPaths
vaultReturn: () => '/client/vault/return',
vaultCancel: () => '/client/vault/cancel',
```

2. A client payment approved in Terms returns `paypalApprovalUrl` from `POST /api/approvals/:id/decision`. Which page should PayPal send the person back to? The web app assumes `/approvals`. If it should be another page, please add it to `webPaths` too.

3. `GET /api/audit` says each business sees entries about its own records. Please confirm what a client sees on a deal it shares with the owner. The mock shows a client the negotiation messages, its own side's steps and PayPal's steps, but not the owner's approvals or the supplier agent's reasons (for example, that a counter goes over the owner's ceiling), and shows the owner no client's policy or saved-method entries.
