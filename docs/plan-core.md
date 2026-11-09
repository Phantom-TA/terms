# Core plan (Developer A)

This is the working plan for everything in Developer A's area (see `CONTEXT.md`, "Team, ownership and branches"). It follows the build order in the core prompt, ordered by risk. Each phase ends with a pull request into `develop`; each feature passes the test gate (typecheck, lint, format, unit, integration, sandbox where relevant) before it is committed.

Status of each feature lives in `docs/progress-core.md`; design decisions in `docs/decisions-core.md`.

## Toolchain

| Concern         | Choice                                                                                                         | Why                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Runtime         | Node 24 LTS                                                                                                    | Current LTS; native `fetch`, stable ESM                                       |
| Package manager | pnpm workspaces                                                                                                | Strict dependency graph, fast CI                                              |
| Language        | TypeScript 6.0, `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                         | typescript-eslint supports up to 6.0; TS 7 is not yet supported by the linter |
| Validation      | zod 4                                                                                                          | One schema gives runtime validation and the static type                       |
| Tests           | Vitest 5, fast-check 4, Supertest                                                                              | Unit, property and HTTP integration tests in one runner                       |
| Lint and format | ESLint 10 flat config with typescript-eslint (type-checked rules), Prettier 3                                  |                                                                               |
| Database        | PostgreSQL 17 through Prisma; Docker Compose locally, a service container in CI, Render Postgres in production |                                                                               |
| Money           | Integer cents as `bigint`; percentages as integer basis points                                                 | No floats anywhere in money or rate maths                                     |

`packages/shared` is consumed from source during development through a custom export condition (`@terms/source`) and from its compiled `dist/` in production builds, so the web app and the API always see the same contracts without a watch build.

## Phases

### Phase 0: scaffold and contracts

- Root: `package.json` (workspaces and scripts), `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint and Prettier config, `.editorconfig`, `.gitignore`, `.gitattributes`, `.nvmrc`, `docker-compose.yml` (Postgres 17), `.env.example` (every variable in CONTEXT.md), MIT `LICENSE`, pre-commit secret scan, GitHub Actions CI (install, build shared, typecheck, lint, format check, tests with coverage, Postgres service).
- `apps/web/README.md` only: the directory belongs to Developer B.
- `packages/shared`:
  - `money`: parse and format decimal strings, cents arithmetic, discount on an amount (half-up to the cent), basis-point helpers.
  - `rates`: implied annual rate `r = d/(1-d) × 365/t` computed exactly with rationals, exact comparison against a hurdle, and the discount that reaches a target rate (nearest 0.1%).
  - `dates`: calendar-day arithmetic on ISO dates (no time-zone drift).
  - `enums`: deal states, action types, plan and goal statuses, approval types and decisions, actors, message types, policy rules, PayPal invoice statuses, webhook event types, cash-event kinds.
  - `deal-state`: the transition table and `canTransition` / `assertTransition`.
  - `policy`: pure supplier and client checks (maximum discount, do-not-contact, cost ceiling, overdue-no-discount, round limit, expiry, amount bounds, hurdle, cash buffer, auto-pay limit, early-pay cap, never-pay-early) returning typed results.
  - `schemas`: zod schemas for every endpoint request and response, the negotiation message, the error envelope, and the SSE event union.
  - `routes`: route constants and typed path builders.
- Exhaustive unit tests plus fast-check property tests; coverage at least 90% lines.
- `docs/api.md` written from the contracts. PR `a/core` → `develop`, CI green, tag `contracts-v1`.

### Phase 1: PayPal spikes S1–S5

Throwaway scripts in `scripts/spikes/`, each recording PayPal IDs and outcomes in `docs/progress-core.md`. Needs the APIMatic Context Plugin loaded and sandbox credentials. Failed spikes switch to their documented fallback.

### Phase 2: backend core

`apps/api` (Express 5): config loading with zod, Prisma schema for every table and the first migration, PayPal client (OAuth token cache, `PayPal-Request-Id` on every write, retries on 5xx and 429, typed errors with debug IDs), sync of invoices, transactions and balance, webhook receiver (signature verification through PayPal, dedupe on event ID, idempotent processing in a transaction), audit log writer. Integration tests against Postgres from Docker Compose.

### Phase 3: money logic

Planner (exact dynamic programming over the target in $10 units with the tie-breaks from CONTEXT.md, backups, cost ceiling, stop rule), deal state machine on top of the shared transition table with persisted history, approvals (plan, NEEDS_OWNER, backups above the ceiling, client human approval). Property tests: no plan breaks the maximum discount, do-not-contact or ceiling; committed cash only from AGREED-or-later deals.

### Phase 4: AI

Vercel AI SDK with provider-agnostic configuration. Typed roles (goal parser, flow labeller, plan explainer, message writer, two negotiators, reply parser), each output validated by zod and then by the policy layer. Deterministic strategy mode for tests and the simulator. Recorded fixtures for CI and a live mode. `scripts/simulate-negotiations.ts`: 50 seeded runs, pass bar 0 policy violations.

### Phase 5: settlement

Reminders, full invoice update (discount plus partial-payment minimum, or cancel-and-reissue), vault setup, agent payment through Orders, recording the payment against the invoice, the human-approval path. Only verified webhooks (or a server-side PayPal read) move a deal to PAID or PARTIALLY_PAID. Full sandbox cycle with recorded IDs.

### Phase 6: API and live updates

Every endpoint in `packages/shared` routes, the public offer page backend with single-use signed tokens, `POST /api/studio/turn` (rate-limited LLM proxy with read-only tools), `GET /api/stream` (SSE). Integration tests for every endpoint, including error paths and owner/client session separation.

### Phase 7: seed and demo mode

`scripts/seed-sandbox.ts` with run-day-relative dates and `--scale`. A test asserts the scenario numbers: $6,200 gap, $6,510 target, $61 cost, $6,689 committed.

### Phase 8: deployment

`render.yaml` (one web service serving the API and the built frontend, plus Postgres, paid instance), health check, webhook registration against the hosted URL, deploy guide.

### Phase 9: integration with B

Full demo scenario end to end on `develop` from a fresh seed, three clean runs. Backend fixes; frontend issues logged for B.

### Phase 10: docs

`docs/paypal.md`, `docs/ai.md`, `docs/architecture.md`, `docs/api.md`, and the backend sections of `README.md`.

## Things only the owner of the accounts can do

Tracked in `docs/progress-core.md` under "Needs from Developer A (human)": GitHub repository, APIMatic Context Plugin install, PayPal sandbox accounts and REST app features, LLM API key, AG Grid licence (B), Render account.
