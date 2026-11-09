# Core progress (Developer A)

Status: **PASS** = tested successfully with evidence; **PARTIAL** = works with stated limits; **FAIL**; **Not started**.

## Phase 0: scaffold and contracts

| Feature                                            | Status                           | Evidence                                                                                        |
| -------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| pnpm monorepo, strict TS, ESLint, Prettier, Vitest | PASS                             | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean                                        |
| Pre-commit secret scan                             | PASS                             | Runs on every commit; `pnpm check:secrets --all` in CI                                          |
| Docker Compose Postgres + test DB                  | PARTIAL                          | Config written; used from Phase 2 integration tests                                             |
| CI (GitHub Actions, Postgres service)              | PASS once the first run is green | `.github/workflows/ci.yml`                                                                      |
| `@terms/shared` money, rates, dates                | PASS                             | `test/money.test.ts`, `test/rates-dates.test.ts` (unit + fast-check properties)                 |
| Deal state machine                                 | PASS                             | `test/deal-state.test.ts`                                                                       |
| Policy checks (supplier and client)                | PASS                             | `test/policy.test.ts`, including the scenario's $61 vs $60, 1.5% block, Juniper $4,960 approval |
| zod schemas, SSE union, route table                | PASS                             | `test/schemas.test.ts`                                                                          |
| Coverage ≥ 90% lines for shared                    | PASS                             | 99.7% lines, 97.8% branches (`pnpm test:coverage`)                                              |

Merged to `develop` in PR #1 and tagged `contracts-v1`.

## Phase 1: spikes S1–S5

| Spike                                                        | Status  | Evidence                                                                                                                                                       |
| ------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 full update of a SENT invoice (discount, partial minimum) | PASS    | `scripts/spikes/s1-invoice-update.ts`; sandbox invoices `INV2-4N8K-4NFN-JHYN-FX26`, `INV2-V8DF-9KKR-9FR3-REUZ`; payer page checked; docs/paypal.md             |
| S2 agent payment recorded against the invoice                | PARTIAL | Vault order COMPLETED at create (capture `34782754WR027910H`), replay safe; invoice record-payment 404 pending reporting lag; docs/paypal.md                   |
| S3 webhook events and verification                           | PASS    | `scripts/spikes/s3-*.ts` via cloudflared: INVOICE.UPDATED, CAPTURE.COMPLETED, re-delivery, INVOICE.PAID (partial) all verified (API and local); docs/paypal.md |
| S4 Transaction Search lag                                    | PARTIAL | `scripts/spikes/s4-reporting-lag.ts`: ≈2 h lag, 30-min refresh; docs/paypal.md                                                                                 |
| S5 PayPal-wallet vault setup for a client                    | PASS    | `scripts/spikes/s5-vault-setup.ts`: payment token `4hw33165rx315042p` after one approval by Harbor                                                             |

## Phase 2: backend core

| Feature                                                                    | Status      | Evidence                                                                             |
| -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| Local Postgres without Docker (`pnpm db:local`)                            | PASS        | Embedded PostgreSQL 17, UTF-8; integration tests run against it                      |
| Prisma schema (every CONTEXT.md table) and initial migration               | PASS        | `prisma/migrations/*_init`; applied locally and in CI                                |
| Config, DB client, typed errors, logger with redaction                     | PASS        | `apps/api/test/config.test.ts`                                                       |
| Audit log (append-only, secret scrubbing, per-business visibility, paging) | PASS        | `apps/api/test/audit.test.ts` (Postgres)                                             |
| PayPal foundation: write ledger, error mapping, SDK and REST clients       | PASS        | `apps/api/test/paypal/*.test.ts` (fake fetch through the real SDK); `paypal-plan.md` |
| PayPal invoice service (apply terms, remind, record payment)               | PASS        | `apps/api/test/paypal/invoice-service.test.ts`                                       |
| PayPal vault and agent payment services                                    | PASS        | `apps/api/test/paypal/vault-payment.test.ts`                                         |
| Settlement and webhook receiver (verify, store once, settle)               | PASS        | `apps/api/test/paypal/webhook-service.test.ts`, incl. real signed S3 deliveries      |
| PayPal invoice import (sync), HTTP routes                                  | Not started | Phase 6                                                                              |

## Phase 3: money logic

| Feature                                                                                | Status      | Evidence                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner (exact search, tie-breaks, reminders, backups, shortfall, stop rule)           | PASS        | `apps/api/test/planner.test.ts`: scenario reproduced ($6,510 target, Juniper $5,000 + Harbor $1,750 at 0.8%, $54 planned, $6,696 committed if accepted); property tests for limits and optimality vs brute force |
| Deal state machine persistence (actor rules, version lock, history, audit)             | PASS        | `apps/api/test/deal-store.test.ts` (Postgres)                                                                                                                                                                    |
| Approvals (plan, NEEDS_OWNER, backup over ceiling, client payment; expiry, withdrawal) | PASS        | `apps/api/test/approval-service.test.ts` (Postgres)                                                                                                                                                              |
| Plan service (create, Workbench view, owner edits via policy, approve with ceiling)    | PASS        | `apps/api/test/plan-service.test.ts` (Postgres)                                                                                                                                                                  |
| Coverage ≥ 90% lines: planner, deals, plans, approvals                                 | PASS        | 100% lines on each (`pnpm test:coverage`)                                                                                                                                                                        |
| Negotiation strategies (deterministic mode) and deal engine execution                  | Not started | Next: Phase 4 builds the deterministic strategies first, then the LLM negotiators                                                                                                                                |

## Contract requests from Developer B

| Request                                              | Status | Evidence                                                                                |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| CR-1 per-row policy checks on `PlanItemView`         | PASS   | `apps/api/test/plan-service.test.ts` (stored at planning and on edit; DNC rows blocked) |
| CR-2 `paypalCall` and `dealId` on audit, filter      | PASS   | `apps/api/test/audit.test.ts`, `approval-service.test.ts`                               |
| CR-3 web lint, tests, build and bundle check in CI   | PASS   | `.github/workflows/ci.yml` (runs when `apps/web/package.json` exists)                   |
| Ship to B: merge to `develop` and tag `contracts-v2` | Open   | Waits for the owner's approval to open a PR                                             |

## Needs from Developer A (human)

| Item                                                                                                                                                                           | Status                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| GitHub repo Phantom-TA/terms                                                                                                                                                   | Done (private; make public before submission) |
| Teammate added as collaborator                                                                                                                                                 | Done (write access)                           |
| APIMatic Context Plugin for PayPal in Claude Code                                                                                                                              | Done (`paypal@context-plugins` 0.4.1)         |
| PayPal sandbox: Maya Studio, Juniper Labs, Harbor & Co, Oak Street Bakery, Pinecrest Dental, Birch Legal; REST app on Maya with Invoicing, Vault, Transaction Search, Webhooks | Done (token scopes verified; see below)       |
| Maya's sandbox balance at $5,200                                                                                                                                               | Done (shown in the sandbox dashboard)         |
| LLM API key                                                                                                                                                                    | Pending                                       |
| Render account                                                                                                                                                                 | Pending (Phase 8)                             |

### Sandbox access check (2026-11-10)

All six demo accounts are US business sandbox accounts under `@terms-demo.example.com`; the REST app "Terms" is owned by Maya Studio.
An OAuth client-credentials token was issued, and its scopes include Invoicing, Vault, Transaction Search (`reporting/search`), Payouts and webhook management.
`GET /v1/reporting/balances` returned USD 5,000.00 with `as_of_time` 2026-11-09T16:59:59Z, which is earlier than the account itself (created about 18:17 UTC), while the dashboard shows $5,200: reporting data lags (first evidence for spike S4). `GET /v1/notifications/webhooks` returns 200, and `GET /v2/invoicing/invoices` returns 0 invoices.
The credentials are stored only in the local, gitignored `.env`.
