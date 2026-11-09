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

Not started. Blocked on: APIMatic Context Plugin installed in Claude Code (required before any PayPal code), PayPal sandbox accounts and REST app credentials.

## Phase 2: backend core

| Feature                                                                    | Status      | Evidence                                                        |
| -------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------- |
| Local Postgres without Docker (`pnpm db:local`)                            | PASS        | Embedded PostgreSQL 17, UTF-8; integration tests run against it |
| Prisma schema (every CONTEXT.md table) and initial migration               | PASS        | `prisma/migrations/*_init`; applied locally and in CI           |
| Config, DB client, typed errors, logger with redaction                     | PASS        | `apps/api/test/config.test.ts`                                  |
| Audit log (append-only, secret scrubbing, per-business visibility, paging) | PASS        | `apps/api/test/audit.test.ts` (Postgres)                        |
| PayPal client, sync, webhook receiver                                      | Not started | Waits for the APIMatic plugin and sandbox credentials           |

## Phase 3: money logic

| Feature                                                                                | Status      | Evidence                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planner (exact search, tie-breaks, reminders, backups, shortfall, stop rule)           | PASS        | `apps/api/test/planner.test.ts`: scenario reproduced ($6,510 target, Juniper $5,000 + Harbor $1,750 at 0.8%, $54 planned, $6,696 committed if accepted); property tests for limits and optimality vs brute force |
| Deal state machine persistence (actor rules, version lock, history, audit)             | PASS        | `apps/api/test/deal-store.test.ts` (Postgres)                                                                                                                                                                    |
| Approvals (plan, NEEDS_OWNER, backup over ceiling, client payment; expiry, withdrawal) | PASS        | `apps/api/test/approval-service.test.ts` (Postgres)                                                                                                                                                              |
| Plan service (create, Workbench view, owner edits via policy, approve with ceiling)    | PASS        | `apps/api/test/plan-service.test.ts` (Postgres)                                                                                                                                                                  |
| Coverage ≥ 90% lines: planner, deals, plans, approvals                                 | PASS        | 100% lines on each (`pnpm test:coverage`)                                                                                                                                                                        |
| Negotiation strategies (deterministic mode) and deal engine execution                  | Not started | Next: Phase 4 builds the deterministic strategies first, then the LLM negotiators                                                                                                                                |

## Needs from Developer A (human)

| Item                                                                                                                                                                           | Status                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| GitHub repo Phantom-TA/terms                                                                                                                                                   | Done (private; make public before submission) |
| Teammate added as collaborator                                                                                                                                                 | Pending                                       |
| APIMatic Context Plugin for PayPal in Claude Code                                                                                                                              | Pending                                       |
| PayPal sandbox: Maya Studio, Juniper Labs, Harbor & Co, Oak Street Bakery, Pinecrest Dental, Birch Legal; REST app on Maya with Invoicing, Vault, Transaction Search, Webhooks | Pending                                       |
| LLM API key                                                                                                                                                                    | Pending                                       |
| Render account                                                                                                                                                                 | Pending (Phase 8)                             |
