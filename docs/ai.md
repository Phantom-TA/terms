# AI and negotiation (Developer A)

How the agents decide, what bounds them, and the evidence that they stay inside both parties'
policies. Model roles and the LLM negotiators are added in the next part of Phase 4. This page covers
the deterministic layer they are measured against.

## Default strategies (deterministic mode)

`apps/api/src/negotiation/strategies.ts` implements CONTEXT.md's "Default negotiation strategies" as
pure functions over cents and basis points.

**Client agent:**

- Accepts when the return meets its hurdle and the cap, buffer and limit rules pass.
- Otherwise counters at the discount reaching its target rate, rounded to the nearest 0.1% and never
  below the hurdle.
- Splits to a smaller partial amount, in $250 steps, when the early-pay cap or the cash buffer
  requires it.
- Declines a supplier it never pays early, an offer with no early payment, or an offer it cannot
  counter in the last round.

**Supplier agent:**

- Accepts a counter up to d_max (D-016).
- Answers an ask above d_max with a counter at d_max, and never offers above it.
- Sends any move that would cross the plan's cost ceiling to the owner (NEEDS_OWNER).

Both use the shared policy layer (`@terms/shared` policy and rate functions).

`apps/api/test/negotiation/strategies.test.ts` reproduces the CONTEXT.md demo move by move:

1. Juniper accepts 0.8%, at 16.4% a year. Its person approves $4,960, which is above its $3,000 limit.
2. Harbor counters 0.8% at 1.5%, its 23% target.
3. Maya can go only to 1.2%, which is $1 over the $60 ceiling, so the owner decides.
4. Harbor accepts 1.2%, at 18.5% a year, and pays $1,729 within its $2,000 limit.

Property tests (fast-check) check that client counters never break the client's own rules, and that
the supplier never goes above d_max or over the ceiling without the owner.

## Negotiation simulator

`apps/api/src/negotiation/simulator.ts` plays seeded negotiations with random supplier and client
policies. Movers are pluggable, so the LLM negotiators will run through the same harness. A
**separate violation checker** re-derives every rule from CONTEXT.md with its own arithmetic. It
covers:

- Supplier: maximum discount, cost ceiling without the owner, amount within the invoice, pay-by
  before due, do-not-contact, round limit.
- Client: hurdle rate, cash buffer, early-pay cap, never-pay-early, a person's approval above the
  auto-pay limit.
- Shape: the split flag.

Tests prove the checker catches deliberately broken agents.

`pnpm spike ../../scripts/simulate-negotiations.ts [runs] [firstSeed]` prints a report and fails on
any violation.

| Run (2026-11-10)                          | Agreed | Declined | Owner asked (approved) | Client person approvals | Violations |
| ----------------------------------------- | ------ | -------- | ---------------------- | ----------------------- | ---------- |
| 50 runs, seeds 1–50 (CONTEXT.md pass bar) | 33     | 17       | 6 (4)                  | 13                      | **0**      |
| 1,000 runs, seeds 1001–2000               | 592    | 408      | 92 (56)                | 198                     | **0**      |

The first run found two faults, both fixed before these results:

- The scenario generator produced opening offers over the plan ceiling, which the planner never
  does.
- Agreements accepted by the supplier were not flagged for the client's person above the auto-pay
  limit. The deal engine requests that approval on every agreement, and the payment service already
  refuses without it.
