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

## Phase 1: spikes S1–S5

Not started. Blocked on: APIMatic Context Plugin installed in Claude Code, PayPal sandbox accounts and REST app credentials.

## Needs from Developer A (human)

| Item                                                                                                                                                                           | Status                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| GitHub repo Phantom-TA/terms                                                                                                                                                   | Done (private; make public before submission) |
| Teammate added as collaborator                                                                                                                                                 | Pending                                       |
| APIMatic Context Plugin for PayPal in Claude Code                                                                                                                              | Pending                                       |
| PayPal sandbox: Maya Studio, Juniper Labs, Harbor & Co, Oak Street Bakery, Pinecrest Dental, Birch Legal; REST app on Maya with Invoicing, Vault, Transaction Search, Webhooks | Pending                                       |
| LLM API key                                                                                                                                                                    | Pending                                       |
| Render account                                                                                                                                                                 | Pending (Phase 8)                             |
