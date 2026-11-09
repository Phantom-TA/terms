# Contract requests (Developer B to Developer A)

Open requests against `@terms/shared` and root tooling. Until each ships, the web app builds against what exists.

## CR-1: per-row policy checks on `PlanItemView`

**Status:** built by A on `a/core` (`bb8e70d`), waiting for `contracts-v2` on `develop`. **Needed for:** Phase 2, Workbench policy-badges column. The column is left out until this ships (decision W-017).

The Workbench shows policy badges on every row, but `PlanItemView` has no checks. `UpdatePlanItemResponse.policyChecks` only covers a row just edited. Computing them in the browser would show checks the server may not have run.

```ts
// packages/shared/src/schemas/plans.ts, PlanItemView
/** Checks the planner ran on this row. Empty for NONE rows with nothing to check. */
policyChecks: z.array(PolicyCheckView),
```

## CR-2: which PayPal call an audit entry records

**Status:** built by A on `a/core` (`bb8e70d`), waiting for `contracts-v2` on `develop`. **Needed for:** Phase 3, Negotiation Room API chips.

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

**Status:** built by A on `a/core` (`0e7d13a`), waiting to reach `develop`. **Why:** root `lint` and `test` exclude `apps/web` by design, so CI currently runs only its typecheck.

Add to `.github/workflows/ci.yml`, after "Test with coverage":

```yaml
- name: Web lint and component tests
  run: pnpm --filter @terms/web lint && pnpm --filter @terms/web test

- name: Web production build and bundle check
  run: pnpm --filter @terms/web exec vite build && node apps/web/scripts/check-prod-bundle.mjs
```

The Render build also needs `apps/web` built, with `dist` served by the API for non-`/api` routes, including `/offer/:token`.
