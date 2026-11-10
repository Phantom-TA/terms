# AI and negotiation (Developer A)

How the agents decide, what bounds them, and the evidence that they stay inside both parties'
policies. The first half of this page is the deterministic layer; "The AI roles" below is the model
layer that sits on it. The rule throughout: **a model chooses and words; code decides what is
allowed.** Every role has a deterministic fallback, so a missing key, a provider outage or a bad
answer makes the app plainer, never wrong or stuck.

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

## Negotiation engine

`apps/api/src/negotiation/engine.ts` runs negotiations on real deals.

**Messages and state.** Each message is a structured `NegotiationMessage`:

- terms, the payer's annual rate, the amount to pay now, the policy checks, the round and the
  expiry;
- stored and audited (for both businesses) in the same transaction as the deal transition, before
  anything is delivered.

**Turns:**

- `sendOffer` sends the approved plan row (round 1).
- `clientTurn` and `supplierTurn` let each agent move.
- `runAgents` steps both until the deal waits for something else: the owner, a person, or PayPal.

**What the engine decides on top of the movers:**

- **Guards:** every move is checked against both policies before it takes effect (`guardClientMove`,
  `guardSupplierMove`). A blocked move throws `POLICY_BLOCKED` and nothing is stored. The LLM
  negotiators will be held to the same guards.
- **NEEDS_OWNER:** a move over the plan's ceiling creates a `COUNTER_OVER_PLAN` approval carrying
  the prepared terms and the cost impact. The owner's yes sends the prepared counter or accept,
  re-checked against the hard limits. A no declines.
- **The client's person:** an agreement whose payment is above the client's auto-pay limit creates
  a `CLIENT_PAYMENT` approval for that exact amount, whoever accepted. The payment service refuses
  to pay without it.
- **Expiry:** offers expire after 48 hours. A late answer finds the deal EXPIRED, and `expireDue`
  closes the rest.

`apps/api/test/negotiation/engine.test.ts` plays the whole demo on Postgres, from the approved plan
to the agreed deals:

- Juniper: agreed, with its person's approval requested for $4,960.
- Harbor: counter at 1.5% (23.2% a year), then NEEDS_OWNER at $61 against the $60 ceiling, the
  owner approves, a counter at 1.2% in round 3, and Harbor accepts at 18.5% a year for $1,729.
- The plan ends with $6,689 committed against the $6,510 target, for $61, and the goal met.

It also shows that a reckless, sneaky or greedy mover is refused with nothing stored.

## The AI roles

Built on the Vercel AI SDK 7 with the `anthropic`, `openai` or `google` provider (`LLM_PROVIDER`).
Decisions use `LLM_MODEL` ("smart"); explanations, notes and labels use `LLM_MODEL_FAST`.

| Role (`apps/api/src/ai/`)               | Model | Used for                                    | When the model fails or is refused                           |
| --------------------------------------- | ----- | ------------------------------------------- | ------------------------------------------------------------ |
| `goal-role.ts` goal parser              | smart | The owner's sentence → goal fields          | The rule-based parser reads it alone (audit says why)        |
| `reply-role.ts` reply parser            | smart | A free-text reply on the offer page         | 502 `AI_ERROR`: "please use the buttons"; nothing changes    |
| `negotiator-role.ts` client + supplier  | smart | Which allowed move each agent makes         | The standard strategy's move                                 |
| `note-role.ts` message writer           | fast  | The note on each negotiation message        | The engine's plain deterministic note                        |
| `explainer-role.ts` plan explainer      | fast  | Why a plan row is what it is                | The row shows the planner's own reason (`explanation: null`) |
| `labeller-role.ts` flow labeller        | fast  | Kind and label for unclassified PayPal txns | The transaction keeps PayPal's own wording                   |
| `studio-role.ts` Cash Studio strategist | smart | `POST /api/studio/turn` (tool-calling loop) | 502 `AI_ERROR`                                               |

Without an API key none of these run and the app behaves as before. `AI_NEGOTIATION=deterministic`
keeps the negotiators and the writer off even with a key (for a reproducible demo).

### What bounds a model

- **Schema.** Every answer is parsed by zod before use (`AiRunner.run` never returns an unparsed
  answer). A malformed answer is an `invalid` failure.
- **Guards.** A negotiator's answer becomes a move that must pass the same pure guards as any
  strategy's move (`negotiation/guards.ts`): the owner's maximum discount, hard policy blocks, the
  cost ceiling (a move over it becomes `NEEDS_OWNER`, never a silent yes), an accept must accept the
  terms as made. A move that fails is thrown away and the standard strategy's move is used. Each side's
  model is shown only its own policy and the public terms.
- **Figures.** Text a model writes for people (notes, explanations, labels) may state only figures its
  facts contain, matched **by kind**: a dollar amount against dollar amounts, a percentage against
  percentages, any other number against plain numbers. So the 9 in a date cannot vouch for an invented
  "9%". A note may not name a policy, include markup or links, or run long.
- **Untrusted text.** The owner's sentence, a client's reply, invoice and transaction text are fenced
  in the prompt (`<owner_sentence>` and so on, closing tags inside are removed) and the system text says
  they are data, never instructions.
- **No model call inside a transaction.** The engine decides first (model call), then opens a
  transaction, checks the deal's version has not changed, and applies the move. An offer that lapsed
  while the agent was deciding is closed, not agreed to. A note written for an owner approval is kept on
  the approval (`draftNote`) so the owner's decision calls no model.
- **Privacy.** The message writer and the negotiators' public notes carry terms only; a side's real
  reasons stay in its own history (D-023).

### Evidence that a model cannot break a limit

`apps/api/test/ai/negotiator-role.test.ts` throws random negotiator answers (any move, any discount,
any amount) at the real engine on Postgres, then checks the transcript with code that shares nothing
with the guards: every supplier message within the owner's maximum, every client message meeting its
hurdle and early-pay cap, at most three rounds, an agreed deal within the ceiling unless the owner
approved going over, and a waiting-for-owner deal always having an approval to decide. It runs 30 cases
in the gate and was run at 300 (twice) while building. The first 300-case run found a counterexample;
it was a wrong due date in the checker (the invoice is due 3 December, the checker assumed the 4th), not
the engine, and that case is now pinned as a permanent example.

### Reply parser: what a written reply can do

The person at the client is a counterparty. The model can only choose among the page's own actions:
pay now, pay part now (same discount, amounts in $250 steps within the page's limits), not now, or
nothing. A reply that is hedged, a question, or asks for other terms changes nothing and the person is
asked to use the buttons. A promise to pay later is noted in the audit trail (`OFFER_REPLY`) and
shown back, and is never counted as cash.

### Cash Studio strategist

One call per turn of `POST /api/studio/turn` (the loop is run by the browser; the server is stateless).
The model has five read-only server tools (`get_open_invoices`, `get_cash_runway`, `get_plan_summary`,
`get_cash_history`, `simulate_discount_cap`), each scoped to the signed-in owner and bounded in size, and
the widget tools the browser declared (no `execute` here: the call goes back to the browser). The server
rejects a browser tool that shadows a server tool, repeats a name or is oversized, and a tool result
that answers no call the assistant made; it drops a model call to any undeclared tool. The model cannot
approve, send, pay or change anything because no tool it has can. Each turn writes a `STUDIO_TURN` audit
entry (counts and tool names, not the conversation). `simulate_discount_cap` runs the planner with a
different maximum discount and saves nothing; its result also becomes the turn's `scenario` (the runway
under that what-if, worked out on the server from the real balance and confirmed flows), because the
browser can chart only data it has and must not work out payment outcomes. The model is told how to use
screen tools: look at a schema tool such as `view_schema` first, use only identifiers it lists, and expect
to build in several calls. Tool results over 32 KB reach it as a short preview, and the model's context is
the limit on how large the browser's tool definitions can be (256 KB cap, about 60k tokens).

### Recording and replaying (no key needed)

`AI_MODE=live` calls the provider. `record` calls it and saves each answer under `AI_FIXTURE_DIR`
(`apps/api/test/fixtures/ai/<role>/<hash>.json`, keyed by role, tier, system text and prompt).
`replay` answers from those files and needs no key: CI, the seeded demo and the Render demo can run the
AI roles from recordings. A prompt with no recording fails with a clear message. Run the demo once with
`AI_MODE=record` and a key to create the recordings; commit them.
