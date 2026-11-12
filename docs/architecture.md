# Architecture

Terms is one TypeScript monorepo (pnpm workspaces): a shared contract package, an Express API and a
React web app. The API serves the built web app, so production is one service and one Postgres.

```
apps/web  (React, AG Grid, AG Charts, AG Studio)      browser
   |  HTTP + SSE, typed by packages/shared
apps/api  (Express 5, Prisma 7)                       one Node service
   |-- planner        deterministic cheapest-cover plan
   |-- negotiation    engine + guards + strategies (+ AI negotiators)
   |-- ai             model roles, always with a deterministic fallback
   |-- paypal         Invoicing, Vault, Orders, Transaction Search, webhooks (APIMatic SDK)
   |-- deals          the deal state machine and the runner that executes approved plans
   '-- http           routes, sessions, live events
Postgres  (Prisma)                                     every deal, message, approval and audit entry
PayPal sandbox                                         the source of truth for money
```

## The contract

`packages/shared` holds every request and response as a zod schema, the route table, the deal state
machine, money and rate maths, and the pure policy checks. Both apps import it. Every API route is
declared there once: the server parses requests and checks its own responses against those schemas
(a mismatch is a 500, never a silent change), and the web app uses the same types. Changes are
versioned (`CONTRACTS_VERSION`, git tags `contracts-v1` to `contracts-v4`) and listed in
[api.md](api.md).

## How a goal becomes cash

1. **Goal.** The owner's sentence is parsed (AI goal parser, rule-based fallback) into amount,
   deadline, maximum discount and protected clients; the owner confirms every field.
2. **Plan.** The planner (pure code) picks the cheapest set of early-payment offers, partial payments
   and reminders that covers the gap plus a buffer, within the cost ceiling. Explanations are written
   afterwards by a model and never change the plan.
3. **Approval.** Nothing is sent until the owner approves the plan and its cost ceiling.
4. **Negotiation.** For each offer the supplier agent and the client's agent exchange structured
   messages, at most three rounds, each move checked against both sides' policies before it takes
   effect. A move over the ceiling waits for the owner; a payment over the client's auto-pay limit
   waits for a person at the client. Clients without an agent answer on a signed offer page.
5. **Settlement.** Agreed terms are written onto the PayPal invoice. An agent client pays from its saved
   PayPal method (Vault); a person pays the PayPal invoice. A deal counts as paid only on PayPal's
   verified webhook. Once committed cash covers the target, open offers are withdrawn.

## Safety by construction

- **Money limits live in code.** Discounts, ceilings, hurdles and approval limits are enforced by the
  policy layer and the deal state machine; models only choose among allowed moves ([ai.md](ai.md)).
- **PayPal writes happen once.** Each write is claimed in a ledger before the call and sent with a
  `PayPal-Request-Id`; an unknown outcome is replayed or re-read, never guessed ([paypal.md](paypal.md)).
- **Each side's policy is its own.** On a shared deal, reasons, policy checks and approvals are shown
  only to the business they belong to (D-023).
- **Everything is audited**: who or what proposed each step, the checks it passed, the PayPal call and
  its debug ID, and the webhook that confirmed it.

## Live updates

The browser holds one server-sent-events stream per session (`GET /api/stream`). Every audit entry and
deal change is published after its transaction commits, and stored, so a reconnect resumes from
`Last-Event-ID` without losing anything.

## Where things are

| Area            | Code                             | Docs                                        |
| --------------- | -------------------------------- | ------------------------------------------- |
| Contract        | `packages/shared/src`            | [api.md](api.md)                            |
| Planner         | `apps/api/src/planner`, `plans`  | [decisions-core.md](decisions-core.md)      |
| Negotiation, AI | `apps/api/src/negotiation`, `ai` | [ai.md](ai.md)                              |
| PayPal          | `apps/api/src/paypal`            | [paypal.md](paypal.md)                      |
| HTTP, live      | `apps/api/src/http`              | [api.md](api.md)                            |
| Web app         | `apps/web`                       | [apps/web/README.md](../apps/web/README.md) |
| Deployment      | `render.yaml`                    | [deploy.md](deploy.md)                      |
