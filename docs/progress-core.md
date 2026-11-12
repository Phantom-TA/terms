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

## Phase 4: AI and negotiation

| Feature                                                                            | Status | Evidence                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Default negotiation strategies (deterministic mode)                                | PASS   | `apps/api/test/negotiation/strategies.test.ts`: demo flow move by move, property tests                                    |
| Negotiation simulator: 0 policy violations in 50 runs                              | PASS   | `scripts/simulate-negotiations.ts`: 50 runs 0 violations; 1,000 runs 0 violations (docs/ai.md)                            |
| Negotiation engine (messages, rounds, NEEDS_OWNER, client approvals)               | PASS   | `apps/api/test/negotiation/engine.test.ts`: full demo on Postgres, guards refuse bad moves                                |
| AI runner: live, record and replay behind one interface                            | PASS   | `apps/api/test/ai/runner.test.ts`, `chat.test.ts` (real SDK tool loop on the SDK's mock model)                            |
| Goal parser and reply parser (with fallbacks and bounds)                           | PASS   | `ai/goal-role.test.ts`, `ai/reply-role.test.ts`, `http/goals-ai.test.ts`, `http/offers.test.ts`                           |
| LLM negotiators and message writer: a model cannot break a limit                   | PASS   | `ai/negotiator-role.test.ts`: random answers on the real engine, 300 cases twice; `ai/note-role.test.ts`                  |
| Plan explainer and flow labeller                                                   | PASS   | `ai/explainer-role.test.ts`, `plans/plan-explainer.test.ts`, `ai/labeller-role.test.ts`, `paypal/sync-labelling.test.ts`  |
| CR-5 what-if `scenario`; larger Studio body limit; oversize tool results truncated | PASS   | `http/studio.test.ts` (real data, limits), `ai/studio-role.test.ts`, shared `StudioTurnResponse` tests                    |
| Cash Studio strategist (`POST /api/studio/turn`)                                   | PASS   | `ai/studio-*.test.ts`, `http/studio.test.ts`: real data, scoping, validation, audit, rate limit                           |
| Against a real model (live)                                                        | PASS   | 2026-11-12, Gemini `gemini-3.5-flash-lite`: the demo flow through the API, every role answered; hosted demo run on Render |

## Phase 6: API and live updates

| Feature                                                                               | Status  | Evidence                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP layer: contract-checked routes, sessions (httpOnly, hashed), errors, request ids | PASS    | `apps/api/test/http/core.test.ts`                                                                                                       |
| Server-sent events with Last-Event-ID replay                                          | PASS    | `core.test.ts` (real socket)                                                                                                            |
| Goals (rule-based parser, D-017), plans, deals, Workbench rows                        | PASS    | `apps/api/test/http/planning.test.ts`, `apps/api/test/goals/goal-parser.test.ts` (20 phrasings)                                         |
| Approvals, policies, audit trail                                                      | PASS    | `core.test.ts`                                                                                                                          |
| Deal runner: execution, stop rule, backups within and over the ceiling                | PASS    | `apps/api/test/http/runner-client.test.ts`                                                                                              |
| Client offers, saved PayPal method, PayPal webhook route                              | PASS    | `runner-client.test.ts`, `demo-flow.test.ts`                                                                                            |
| Public offer page: signed links, button replies, rate limit                           | PASS    | `apps/api/test/http/offers.test.ts`                                                                                                     |
| PayPal import (sync), Connect screen, cash runway                                     | PASS    | `apps/api/test/http/cash.test.ts`                                                                                                       |
| Demo end to end through the API (fake PayPal at the network level)                    | PASS    | `apps/api/test/http/demo-flow.test.ts`: $6,689 committed against $6,510 for $61, goal met, PARTIALLY_PAID and PAID by verified webhooks |
| Cash Studio turn                                                                      | PARTIAL | Route rate-limited; answers NOT_CONFIGURED until the LLM agent exists                                                                   |
| Free-text offer replies                                                               | PARTIAL | NOT_CONFIGURED until the LLM reply parser exists (D-022)                                                                                |

## Phase 7: seed

| Feature                                                                                            | Status              | Evidence                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| Demo seed: businesses, policies, payroll flow, real sandbox invoices created and sent, real import | PASS (fake sandbox) | `apps/api/test/seed/demo-seed.test.ts`; `pnpm seed`          |
| Seed run against the real sandbox                                                                  | Not run yet         | Waits for the owner's go-ahead on cancelling spike leftovers |

## Phase 8: deployment

| Feature                                                          | Status  | Evidence                                                                                                                       |
| ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| One-command production build and start (`build:prod`, `start`)   | PASS    | Built and started locally with `NODE_ENV=production`: health `database: ok`, SPA served for `/`, `/offer/:token`, vault return |
| `render.yaml` (web service + Postgres, migrations, health check) | PARTIAL | Written; not yet deployed (needs the Render account)                                                                           |
| PayPal webhook registration for the hosted URL                   | PARTIAL | `pnpm webhook:register <url>` (idempotent); run after the first deploy                                                         |
| Deploy guide                                                     | PASS    | `docs/deploy.md`                                                                                                               |

## Contract requests from Developer B

| Request                                              | Status | Evidence                                                                                                  |
| ---------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| CR-1 per-row policy checks on `PlanItemView`         | PASS   | `apps/api/test/plan-service.test.ts` (stored at planning and on edit; DNC rows blocked)                   |
| CR-2 `paypalCall` and `dealId` on audit, filter      | PASS   | `apps/api/test/audit.test.ts`, `approval-service.test.ts`                                                 |
| CR-3 web lint, tests, build and bundle check in CI   | PASS   | `.github/workflows/ci.yml` (runs when `apps/web/package.json` exists)                                     |
| CR-4 vault pages in `webPaths`; per-side visibility  | PASS   | `core.test.ts`, `vault-payment.test.ts`, `planning.test.ts`, `engine.test.ts`, `approval-service.test.ts` |
| Ship to B: merge to `develop` and tag `contracts-v2` | Open   | Waits for the owner's approval to open a PR                                                               |

## Needs from Developer A (human)

| Item                                                                                                                                                                           | Status                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| GitHub repo Phantom-TA/terms                                                                                                                                                   | Done (private; make public before submission) |
| Teammate added as collaborator                                                                                                                                                 | Done (write access)                           |
| APIMatic Context Plugin for PayPal in Claude Code                                                                                                                              | Done (`paypal@context-plugins` 0.4.1)         |
| PayPal sandbox: Maya Studio, Juniper Labs, Harbor & Co, Oak Street Bakery, Pinecrest Dental, Birch Legal; REST app on Maya with Invoicing, Vault, Transaction Search, Webhooks | Done (token scopes verified; see below)       |
| Maya's sandbox balance at $5,200                                                                                                                                               | Done (shown in the sandbox dashboard)         |
| LLM API key (to run the AI roles against a real model and record fixtures)                                                                                                     | Pending                                       |
| Render account                                                                                                                                                                 | Pending (Phase 8)                             |

### Sandbox access check (2026-11-10)

All six demo accounts are US business sandbox accounts under `@terms-demo.example.com`; the REST app "Terms" is owned by Maya Studio.
An OAuth client-credentials token was issued, and its scopes include Invoicing, Vault, Transaction Search (`reporting/search`), Payouts and webhook management.
`GET /v1/reporting/balances` returned USD 5,000.00 with `as_of_time` 2026-11-09T16:59:59Z, which is earlier than the account itself (created about 18:17 UTC), while the dashboard shows $5,200: reporting data lags (first evidence for spike S4). `GET /v1/notifications/webhooks` returns 200, and `GET /v2/invoicing/invoices` returns 0 invoices.
The credentials are stored only in the local, gitignored `.env`.
