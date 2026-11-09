# Terms — Product Context

This file is the single source of truth for building Terms. Read it fully before writing code. Both developers' Claude Code sessions use it.

## Summary

We are building **Terms**. A small-business owner tells an agent how much cash they need and by when, and the agent closes that gap at the lowest cost. Where a client runs its own agent, the two agents negotiate the payment terms; PayPal settles every deal. **Tagline:** Net 30 is a rule from the paper era.

**The owner's goal, in one sentence:** "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch."

Three product rules shape everything:

1. **The goal comes from the owner.** The owner states the amount, the deadline and the limits in plain words; the forecast confirms or questions that number.
2. **The owner approves the plan.** Nothing is sent until the owner approves it, and any counter-offer that costs more than the approved plan comes back for approval.
3. **Reminders are one small action.** A reminder costs nothing and is tried first where it fits, but it is never counted as committed cash.

Agent-to-agent negotiation is the centrepiece, the PayPal invoice *is* the deal, limits are enforced in code, and settlement is confirmed only by verified PayPal webhooks.

### What makes it different

QuickBooks' Payments Agent and Sage's Payments Agent already chase invoices with AI reminders, and the owner approves. Terms does what they don't: **it negotiates with an agent on the client's side over when and how much gets paid, within both businesses' policies, and only as much as the owner's cash goal requires.** The product must make that part visible.

### Context: PayPal AI Hackathon 2026

Terms is our entry to the PayPal AI Hackathon ("Build what's next with PayPal and AI"). It must meaningfully use the PayPal developer platform (free sandbox) and AI, be a working build judges can run, and be documented well enough to evaluate. Judging criteria, equally weighted: Technological Implementation, Design, Potential Impact, Innovation, Presentation. Sponsor tools we use: **AG Grid** (AG Grid, AG Charts, AG Studio) in the product, **APIMatic Context Plugin** to build the PayPal integration, **Render** for hosting.

## Problem and audience

Small businesses are owed money they have already earned, and they hit cash gaps (payroll, rent, contractors) while waiting for it. The fix businesses have today is chasing invoices; the fix their clients would welcome, a fair price for paying early, almost never happens because nobody has time to negotiate it.

| Fact | Figure | Source |
| --- | --- | --- |
| US small businesses with invoices more than 30 days overdue | 59% in 2026, up from 47% in 2025 | [QuickBooks 2026 report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/) |
| Average owed to businesses waiting on invoices | $17.7K | [QuickBooks 2026 report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/) |
| Average US wait to be paid, Q2 2026 | 29.3 days, almost 9 days late | [Xero data via ABC17](https://abc17news.com/?p=1641455) |
| Return to a payer taking a 2% discount on net 30 | About 36% a year | [Ntropy](https://www.ntropy.com/blog/build-ai-supplier-payment-agent) |
| Invoices paid inside the discount window | About 15% | [Ntropy](https://www.ntropy.com/blog/build-ai-supplier-payment-agent) |
| Two treasury agents negotiating timing and discounts | Described by JPMorgan in June 2026 as prospective | [PYMNTS](https://www.pymnts.com/?p=4224575) |

### Who uses it

- **Owner (supplier):** freelancers, agencies and small wholesalers that invoice through PayPal. They need a specific amount by a specific date, and they don't want to discount everything or annoy good clients.
- **Client (payer):** small and mid-size businesses. Some run their own Terms agent with a policy (hurdle rate, cash buffer, approval limit); others are humans who receive a one-click offer page or a reminder.

### What exists, and the gap

| Product | What it does | What it does not do |
| --- | --- | --- |
| [QuickBooks Payments Agent](https://www.cpapracticeadvisor.com/2025/06/27/intuit-rolls-out-ai-agents-for-quickbooks/163868/) | Predicts late payment, sends AI reminders, tracks invoices | No goal-driven plan; no negotiation with the client side |
| [Sage Payments Agent](https://beancount.io/blog/2026/11/03/sage-copilot-payments-agent-sole-trader-invoice-chasing-freelancer-guide) | Drafts invoices, sends reminders, matches payments; owner approves | Same: chasing only |
| Paying-side AP agents (ChatFin, Spendflo, Centime) | Help large buyers find and take discounts | One-sided, mid-market and enterprise |
| Invoice factoring and instant-transfer fees | A lender advances cash for a fee | The client never benefits; a third party takes the margin |

**Terms' wedge:** a goal-driven plan that the owner approves, executed through negotiation with the client's agent where one exists, settled on PayPal.

## Team, ownership and branches

Two developers build Terms in parallel on separate branches. Directory ownership prevents merge conflicts: never edit files outside your own area.

| Area | Owner | Directories and files |
| --- | --- | --- |
| Repo scaffold, tooling, CI, licence, env | **A** (core) | root config files, `.github/`, `.env.example`, `LICENSE`, `render.yaml` |
| Shared contracts and pure logic | **A** | `packages/shared/` (types, zod schemas for every endpoint, SSE event types, enums, money maths, policy checks, route constants) |
| Backend: PayPal, AI agents, planner, deal engine, webhooks, API, data | **A** | `apps/api/`, `prisma/`, `scripts/` |
| Backend and integration docs | **A** | `docs/api.md`, `docs/paypal.md`, `docs/ai.md`, `docs/architecture.md`, `docs/progress-core.md` |
| Deployment to Render | **A** | `render.yaml`, deploy docs |
| Frontend: design system, every screen, AG Grid / AG Charts / AG Studio UI | **B** (product UI) | `apps/web/` |
| Frontend and product docs | **B** | `README.md` (product sections; A adds setup and backend sections in a final PR), `docs/user-guide.md`, `docs/judging-map.md`, `docs/devpost.md`, `docs/progress-web.md`, `docs/contract-requests.md` |

### Branches

- `main`: protected, release-ready only. Merged from `develop` when the full end-to-end test passes.
- `develop`: integration branch. All work lands here through pull requests.
- `a/core`: A's working branch. `b/web`: B's working branch. Each rebases on `develop` often and opens pull requests into `develop` at every milestone.
- Short-lived feature branches off `a/core` or `b/web` are fine (for example `a/planner`, `b/workbench`).

### The integration contract

- A creates the repo scaffold and `packages/shared` first, merges it into `develop`, and tags it `contracts-v1`. B starts after `contracts-v1` exists.
- `packages/shared` defines every API request and response as a zod schema, the server-sent event union, all enums (deal states, action types, approval types), money and rate helpers, and the pure policy-check functions. The frontend imports these; it never redefines them.
- B never edits `packages/shared`. If B needs a contract change, B writes it in `docs/contract-requests.md` and A implements it and bumps the tag (`contracts-v2`, ...).
- Until an endpoint exists, B may use mocks generated from the shared schemas **only** in tests and in a dev-only mode (`VITE_USE_MOCKS=true`). The production build never contains mocks, and the UI never shows fake success.
- The AG Studio agent runs in the browser but calls the LLM only through the backend endpoint `POST /api/studio/turn` (A builds it, rate-limited; no API key in the browser).

## Principles and guardrails

These rules are non-negotiable for the build and the demo; Claude Code should treat them as acceptance criteria.

1. **PayPal is the source of truth for money.** An invoice is PAID only when a verified PayPal webhook or a server-side PayPal read says so. The frontend never sets payment state, and the AI never declares a payment outcome.
2. **Policy is enforced in code, not in prompts.** Maximum discount, do-not-contact list, cash floor, approval limits and protected clients are checked by deterministic functions before any PayPal call. A model can propose; only the policy layer and a human can authorise.
3. **The owner approves before anything leaves.** The plan is a proposal until the owner approves it. Any counter-offer that raises the plan's cost or breaks its shape returns to the owner.
4. **Only committed cash counts.** The plan counts money as coming in only when a deal is agreed or a payment is confirmed. Reminders are "best effort, not counted". No invented payment probabilities.
5. **Spend only what the goal needs.** The agent stops making offers once committed cash covers the gap plus a small buffer the owner sets.
6. **Every action has a visible state:** suggested → approved → sent → countered → agreed → invoice updated → paid / partially paid, or declined / expired / failed.
7. **Every consequential step is audited:** who or what proposed it, the policy checks run, who approved, the PayPal request and response IDs, and the webhook that confirmed it.
8. **Honest demo data.** Demo businesses, invoices and payments are real sandbox objects created by a seed script and labelled as demo data. Nothing is simulated as a real PayPal result.
9. **No secrets in the frontend or the repo.** Credentials live in server environment variables; `.env.example` lists them.

## How it works

The flow has six stages. Only stage 5 branches, depending on whether a client runs an agent.

1. **Connect.** The owner connects PayPal. Terms imports open invoices (Invoicing: list and search) and recent transactions (Transaction Search). No data entry.
2. **State the goal.** The owner types: "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch."
   1. The goal parser turns this into structured fields: target amount, deadline, maximum discount, do-not-contact list, optional buffer.
   2. The forecaster checks it against history ("Payroll of $11,400 lands Friday; your balance is $5,200; the gap is $6,200 — confirmed") or questions it if the numbers disagree.
3. **Plan.** A deterministic optimiser builds the cheapest plan that commits enough cash by the deadline. The LLM explains each row in plain language.
   1. Each invoice gets one action: none, reminder, partial-payment request, early-payment discount, or negotiate (for clients with an agent).
   2. The workbench shows the gap, committed cash, the total cost and the reason for each row.
4. **Approve.** The owner edits any row (change the action, the discount or the amount, or exclude a client), then approves the plan. Nothing is sent before this.
5. **Execute.** Approved actions go out.
   1. *Client with an agent:* the supplier agent sends a structured offer. The client agent evaluates it against its own policy and accepts, counters, splits or declines. Counters within the approved plan are accepted automatically; counters that cost more come back to the owner.
   2. *Human client:* they get a PayPal invoice reminder, or an offer page ("Pay $4,950 today instead of $5,000 on the 27th") linked from a PayPal invoice reminder. Free-text replies are read by the supplier agent and turned into a structured counter.
6. **Settle.** For each agreed deal, Terms fully updates the PayPal invoice: a discount line, plus a partial-payment minimum for split deals. The client pays.
   1. *Agent client within its limit:* it pays from a saved PayPal payment method, and the payment is recorded against the invoice.
   2. *Above the limit, or a human client:* a person approves in PayPal.
   3. A verified webhook (or server-side status read) moves the invoice to PAID or PARTIALLY\_PAID. Committed cash and the runway update, and the audit trail records every step.

Once committed cash covers the gap plus the buffer, open offers that aren't needed are withdrawn and remaining actions are paused. The owner is told the goal is met.

## Actions and planner

The planner is deterministic code; the LLM only parses the goal, explains the plan and writes the messages. That keeps every number reproducible and auditable.

### Action menu

| Action | When it is chosen | PayPal call | Counts as committed cash? | Cost to the owner |
| --- | --- | --- | --- | --- |
| None | Not needed for the goal, or the client is on the do-not-contact list | — | No | $0 |
| Reminder | Invoice overdue or due before the deadline; tried first because it is free | Invoicing: send invoice reminder | **No** (best effort) | $0 |
| Partial-payment request | The gap is smaller than the invoice, or the client's policy caps early payments | Invoicing: full update with a partial-payment minimum | Yes, once agreed | The discount on the early portion, if any |
| Early-payment discount | The cheapest way to commit a whole invoice | Invoicing: full update with an invoice-level discount | Yes, once agreed | Discount × amount |
| Negotiate | The client runs an agent; any of the above can be offered and countered | Same as above, after agreement | Yes, once agreed | The agreed discount |

### Maths

The owner's cost for a deal is the discount on the portion paid early:

```latex
\text{cost} = d \times A_{\text{early}}
```

The client's return is quoted as an annualised rate, where d is the discount, t is the number of days paid early, and 365 days make a year:

```latex
r = \frac{d}{1 - d} \times \frac{365}{t}
```

Examples: 1.0% paid 18 days early gives 20.5% a year; 1.2% paid 24 days early gives 18.5% a year.

For a split deal (pay A\_early now from an invoice of total T), the invoice is updated with a discount of d × A\_early and a partial-payment minimum of A\_early − discount. Example: Harbor & Co, $7,500 invoice, $1,500 early at 1.2% → discount $18, Harbor pays $1,482 now, $6,000 stays due on the original date.

### Planner rules

1. **Inputs:** gap G, deadline, maximum discount d\_max, opening discount d\_open (default: two-thirds of d\_max, rounded down to 0.1%), do-not-contact list, buffer B (default 5% of G), plan cost ceiling, open invoices, and each client's known capabilities (has an agent or not).
2. **Candidates:** for each contactable invoice that is not yet overdue, an offer at d\_open for the full amount or for a partial amount in $250 steps. Negotiation may later move a row between d\_open and d\_max; the cost ceiling bounds that. Add a free reminder for every contactable invoice that is overdue or due before the deadline. Overdue invoices never get a discount.
3. **Objective:** choose a set of offers whose committed cash (amount minus discount), if all are accepted, covers G + B at the lowest total cost. Ties go, in order, to: fewest partial amounts; fewest dollar-days pulled forward (sum of amount × days early, the smallest ask of clients); fewest clients contacted.
4. **Backups:** rank the next-cheapest offers as backups. The owner approves the plan with a **cost ceiling**. If an offer is declined, the next backup runs automatically while the total stays under the ceiling; above it, the owner is asked.
5. **Stop rule:** once committed cash ≥ G + B, withdraw unneeded open offers and pause the rest.
6. **Size:** a real owner has tens of open invoices, so exact search (dynamic programming over the gap in $10 units) is fast and needs no heuristics.

### Client-side evaluation (client agent)

An offer is acceptable when all of these hold:

- annualised return r is at least the client's hurdle rate;
- the cash left after paying is above the client's buffer;
- the supplier is not on the client's "never pay early" list.

If the amount is above the client's auto-pay limit, a human must approve. If r is below the hurdle, the agent counters at the discount that reaches its **target rate** (rounded to the nearest 0.1%), or with a smaller partial amount. Otherwise it declines with a reason.

### Default negotiation strategies (deterministic bounds)

The LLM negotiators pick moves and write the notes, but every move must stay inside these strategies, and a deterministic strategy mode (no LLM) exists for tests, the simulator baseline and the seeded scenario test.

- **Client agent:** accept if r is at least its hurdle and its cash and limit rules pass. Otherwise counter at the discount that reaches its target rate, rounded to 0.1%. If the amount breaks its early-pay cap, counter with a partial amount within the cap. Decline after 3 rounds.
- **Supplier agent:** accept a counter at or below the approved plan's discount for that row. If a counter is above the row's plan but within d_max, counter at min(d_max, counter); if that pushes total cost over the plan's ceiling, raise NEEDS_OWNER. Never offer above d_max; a client ask above d_max is answered with a counter at d_max.

## Negotiation protocol and policies

Agents exchange **structured messages**, not free chat. The LLM writes the human-readable note on each message and decides *which* allowed move to make; the schema and the policy layer decide *what is allowed*. A negotiation lasts at most 3 rounds and every offer has an expiry.

### Message

```json
{
  "dealId": "deal_01J...",
  "invoiceId": "INV2-XXXX-XXXX-XXXX-XXXX",
  "from": "supplier:maya-studio",
  "to": "client:harbor-co",
  "type": "OFFER | COUNTER | ACCEPT | DECLINE | WITHDRAW",
  "terms": {
    "amountEarly": "1500.00",
    "discountPct": "1.20",
    "payBy": "2026-11-13",
    "remainderDue": "2026-12-03"
  },
  "impliedAnnualRate": "18.5",
  "note": "Happy to take $1,482 today against $1,500 of invoice 1043.",
  "policyChecks": [{ "rule": "maxDiscount", "result": "pass" }],
  "expiresAt": "2026-11-12T18:00:00Z",
  "round": 2
}
```

Money is a decimal string, never a float. Every message is stored in the audit trail before it is delivered.

### Deal states

| State | Meaning | Next states |
| --- | --- | --- |
| SUGGESTED | In the plan, not yet approved | APPROVED, REMOVED |
| APPROVED | Owner approved; not sent | SENT |
| SENT | Offer delivered to the client agent or the offer page | COUNTERED, AGREED, DECLINED, EXPIRED, WITHDRAWN |
| COUNTERED | Client proposed different terms | SENT (supplier counter), AGREED, NEEDS\_OWNER, DECLINED |
| NEEDS\_OWNER | Counter is above the plan's cost or breaks its shape | SENT, AGREED, DECLINED |
| AGREED | Both sides accepted these exact terms | INVOICE\_UPDATED, FAILED |
| INVOICE\_UPDATED | PayPal invoice changed to match the terms | AWAITING\_PAYMENT |
| AWAITING\_PAYMENT | Waiting for the client's payment (agent or human approval) | PAID, PARTIALLY\_PAID, EXPIRED, FAILED |
| PAID / PARTIALLY\_PAID | Confirmed by PayPal webhook or server read | Final |
| DECLINED / EXPIRED / WITHDRAWN / FAILED | Closed with a reason | Final |

### Owner (supplier) policy

| Field | Example | Enforced where |
| --- | --- | --- |
| Target amount and deadline | $6,200 by Friday | Planner |
| Maximum discount | 1.2% | Planner and negotiator; hard block |
| Opening discount | 0.8% (default: two-thirds of the maximum, rounded down to 0.1%) | Planner's first offer on each row |
| Do-not-contact clients | Pinecrest Dental, Birch Legal | Planner; hard block on any message |
| Buffer above target | 5% | Planner stop rule |
| Plan cost ceiling | $60 | Backups and counters; above it, owner approval is needed |
| Tone | Friendly, brief | LLM message drafting only |

### Client policy (for clients running an agent)

| Field | Example (Harbor & Co) | Effect |
| --- | --- | --- |
| Hurdle rate | 15% a year | Accept at or above it |
| Target rate | 23% a year | Opening counter when an offer is below the hurdle |
| Cash buffer | $20,000 | Never pay early below it |
| Auto-pay limit | $2,000 | Above it, a human approves in PayPal |
| Early-payment cap per deal | $5,000 without CFO approval | Triggers a split counter |
| Suppliers never paid early | (empty) | Decline |

## Screens

There are ten screens. The Workbench and the Negotiation Room are the two hero screens; every other screen exists to support them. The visual direction is a calm, document-like finance desk, not a neon AI dashboard: one accent colour for "cash committed", plus clear status colours.

| # | Screen | Who | What it shows and does |
| --- | --- | --- | --- |
| 1 | Connect & import | Owner | Connect PayPal; imported invoices and transactions appear with counts; demo-data label in sandbox |
| 2 | Goal bar | Owner | One input at the top of the Workbench: "I need $6,200 by Friday…". Parsed fields shown as editable chips (amount, date, max %, do-not-contact) before planning |
| 3 | **Workbench** (hero) | Owner | AG Grid, one row per open invoice: client, invoice #, amount, due / days overdue, PayPal status, contact allowed, client has agent, suggested action, discount, cost, committed cash, deal state, approval. Master-detail row: the agent's reasoning and the negotiation transcript. Top rail: gap, committed, cost so far, cost ceiling, **Approve plan** button. Runway chart (AG Charts) with the payroll line, before and after |
| 4 | **Negotiation Room** (hero) | Owner (watching) | Supplier agent and client agent side by side, each in its own colour. Each message shows its terms, the annualised rate and inline policy-check badges (pass / blocked). NEEDS\_OWNER cards appear here with Approve / Reject |
| 5 | Approvals inbox | Owner | Plan approval, counters over the plan, backups over the ceiling; each with cost impact |
| 6 | Client: Payables Desk | Client with an agent | Incoming offers ranked by annualised return; policy settings; history; human approval hand-off to PayPal |
| 7 | Client: Offer page | Human client | "Pay $4,950 today instead of $5,000 on the 27th". Buttons: Pay now with PayPal, Pay part now, Not now, plus a free-text reply box |
| 8 | Cash Studio | Owner | AG Studio with a custom "cash strategist" agent: "What if I cap discounts at 1.5% next month?" builds widgets live; read-only tools |
| 9 | Audit trail | Both | Time-ordered log: proposals, policy checks, approvals, PayPal request and response IDs, webhook events (verified / rejected) |
| 10 | Settings | Both | Policies, connected PayPal account, sandbox and demo labels |

### States every screen must handle

- **Loading:** skeleton rows, not spinners over blank space.
- **Empty:** "No open invoices. Create one in PayPal or run the demo seed."
- **Error:** the PayPal error shown with its debug ID and a retry button; nothing marked done.
- **Pending:** a clear "waiting for PayPal confirmation" state between a client approving and the webhook arriving.
- **No dead buttons.** If an action isn't built, it isn't shown.

## PayPal integration

PayPal does the real work in every step: invoices are the deals, payments settle them, and webhooks confirm them. Everything runs on the free sandbox.

### Sandbox setup

| Sandbox account | Type | Role in the demo |
| --- | --- | --- |
| Maya Studio | Business | The supplier (invoicer). Owns the Terms REST app for the demo |
| Juniper Labs | Business | Client with an agent; pays above its auto-pay limit, so a human approves |
| Harbor & Co | Business | Client with an agent; has a saved PayPal payment method; auto-pays within its limit |
| Oak Street Bakery | Business or personal | Human client; gets a reminder |
| Pinecrest Dental, Birch Legal | Business or personal | On the do-not-contact list; never messaged |

REST app features to enable: Invoicing, Vault (save payment methods), Transaction Search, Webhooks. A seed script creates and sends the demo invoices and a transaction history, so every object in the demo is a real sandbox object.

### APIs used

| Capability | Endpoint | Used for |
| --- | --- | --- |
| OAuth | `POST /v1/oauth2/token` | Server-side access tokens (never in the browser) |
| Create / send invoice | `POST /v2/invoicing/invoices`, `POST /v2/invoicing/invoices/{id}/send` | Seed script; new invoices from the owner's assistant |
| List / search / show | `GET /v2/invoicing/invoices`, `POST /v2/invoicing/search-invoices`, `GET /v2/invoicing/invoices/{id}` | Import and status reads |
| Full update | `PUT /v2/invoicing/invoices/{id}` | Apply the agreed discount and partial-payment minimum |
| Reminder | `POST /v2/invoicing/invoices/{id}/remind` | Reminder action |
| Cancel | `POST /v2/invoicing/invoices/{id}/cancel` | Fallback if a sent invoice can't be updated: cancel and reissue |
| Record payment | `POST /v2/invoicing/invoices/{id}/payments` | Link an agent-made PayPal payment to the invoice |
| Orders | `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture` | Agent payment: payee = Maya, payment source = the client's saved PayPal method |
| Vault | `POST /v3/vault/setup-tokens`, `POST /v3/vault/payment-tokens` | The client saves its PayPal method once, with human approval |
| Balances | `GET /v1/reporting/balances` | Current available balance for the cash position (verify in spike S4; fallback: balance computed from Terms' ledger) |
| Payouts (seed only) | `POST /v1/payments/payouts` | Seed script creates past payroll payments so the history shows a real recurring outflow |
| Transaction Search | `GET /v1/reporting/transactions` | Cash history for the forecast (sandbox data can lag by hours) |
| Webhooks | `POST /v1/notifications/webhooks`, `POST /v1/notifications/verify-webhook-signature` | Register; verify every event before acting on it |

Webhook events to subscribe to (exact names to be confirmed in the first spike): `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.UPDATED`, `INVOICING.INVOICE.CANCELLED`, `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `VAULT.PAYMENT-TOKEN.CREATED`.

### Money flows

1. **Human pays the invoice.** Terms updates the invoice → the client opens the PayPal invoice and pays (or pays the partial minimum) → PayPal marks it PAID or PARTIALLY\_PAID → webhook verified → deal closed.
2. **Agent pays within its limit.** Terms creates an order with Maya as payee and the client's saved PayPal method → captures it → `PAYMENT.CAPTURE.COMPLETED` verified → the payment is recorded against the invoice with its PayPal transaction ID → invoice PAID or PARTIALLY\_PAID. *Spike: confirm that recording a PayPal-method payment produces the right invoice status. Fallback: flow 1 for every payment.*
3. **Agent above its limit.** Same as flow 2, but the order goes through a PayPal approval by a person at the client first.

### Other PayPal tooling

- **Agent Toolkit** (`@paypal/agent-toolkit`): invoice tools for the owner's assistant ("send Oak Street a reminder", "list overdue invoices"). Every tool call goes through the policy layer.
- **PayPal Server SDK** (`@paypal/paypal-server-sdk`) for Orders and Vault; REST for Invoicing and Transaction Search where the SDK doesn't cover them.
- **APIMatic Context Plugin** loaded in Claude Code while building the PayPal integration, which keeps the APIMatic prize open. The README states this.

### Out of scope for the demo (documented as a limitation)

A multi-supplier production version would onboard suppliers through PayPal's partner flows and act on their behalf with third-party permissions. The demo runs one supplier account that owns the app.

## AI architecture

The AI parses, explains, writes and picks negotiation moves; code validates and executes. Every model output is a typed object (a zod schema) that passes schema validation and then the policy layer before anything touches PayPal. Single-purpose model calls plus two negotiating agents, with no open-ended multi-agent swarm.

### Model roles

| Role | Input | Output (typed) | Can it call PayPal? |
| --- | --- | --- | --- |
| Goal parser | Owner's sentence | `{ amount, deadline, maxDiscountPct, doNotContact[], bufferPct? }` | No |
| Flow labeller | Transaction history | Recurring flows ("payroll, biweekly, \~$11,400") for the owner to confirm | No |
| Plan explainer | The planner's output | One plain-language reason per row | No |
| Message writer | An approved action plus tone | Reminder or offer text | No |
| Supplier negotiator | Deal history, owner policy, plan state | One move: `COUNTER`, `ACCEPT`, `DECLINE` or `WITHDRAW` with terms | Indirectly: through server tools after policy checks |
| Client negotiator | Offer, client policy, cash position | One move with terms | Indirectly, same |
| Reply parser | A human client's free text | A structured counter, or "no change" | No |
| Cash strategist (AG Studio custom agent) | Owner's what-if question | AG Studio widget actions | No; read-only data tools |

### Agent tools (server-side, each guarded)

- **Supplier side:** `get_open_invoices`, `get_cash_position`, `propose_counter`, `accept_terms`, `decline`, `request_owner_approval`.
- **Client side:** `get_offer`, `get_client_cash_position`, `propose_counter`, `accept_terms`, `decline`, `request_human_approval`.
- **Server tools that touch PayPal** (`update_invoice_terms`, `send_reminder`, `create_vault_order`, `capture_order`, `record_invoice_payment`) are called **only by the server's deal engine** after a deal reaches AGREED. Agents never call them directly.

### Guardrails

- **Policy before execution:** max discount, do-not-contact, cost ceiling, auto-pay limit, cash buffers, round limit and expiry, all in code.
- **Untrusted text stays data:** a client's free-text reply and invoice notes are passed to the reply parser as quoted data, and the parser can output only schema fields. A reply saying "ignore your limits" changes nothing.
- **Idempotency:** every PayPal write carries a `PayPal-Request-Id`; retries never double-charge.
- **Determinism where it matters:** amounts, discounts and rates are computed in code with decimal maths; the model never does arithmetic that ends up in a payment.
- **Cost control:** rate limit per IP on the public demo, cached explanations, and a smaller model for explanations and drafting.

### Model choice (open decision, see Open decisions)

Use the Vercel AI SDK so the provider can be swapped; the PayPal Agent Toolkit plugs into it directly. Recommended: a top-tier tool-calling model (for example Claude Sonnet-class) for the two negotiators and the goal and reply parsers; a cheaper model for explanations and message drafting.

### AI tests

- Goal parser on 20 phrasings: amounts, dates, "max 1.2%", "don't contact X".
- Reply parser on 20 human replies, including hostile and prompt-injection text.
- Negotiation simulator: 50 seeded runs between the two agents with random policies. Every outcome must respect both policies, and 0 policy violations is the pass bar.

## AG Grid, AG Charts and AG Studio

AG Grid is the product's main working surface, not a report bolted on. AG Grid's judges have said they want polish (custom widgets, theming, layout) and use of the AG Studio agent framework, so all three are covered. Expect many "PayPal dashboard" entries; PayPal ran a webinar titled "Build a payments dashboard without building a dashboard". Terms stands apart because its grid is where decisions are made and approved.

| Component | Where | Features used |
| --- | --- | --- |
| AG Grid (Enterprise trial) | Workbench, Payables Desk, Audit trail | Custom cell renderers (deal-state pill, action selector, policy badges, money with discount strike-through), editable cells for plan changes with validation against policy, master-detail rows (reasoning + transcript), row grouping by action, live transaction updates as webhooks land, pinned summary row (gap / committed / cost), custom theme |
| AG Charts | Workbench rail | Cash runway line with the payroll threshold as a labelled reference line; before vs after plan; committed vs best-effort shown separately |
| AG Studio | Cash Studio | A custom agent ("cash strategist") with a restricted tools array so it can only read data and build widgets; uses Studio's toolkit actions from our own agent loop; a custom widget for the plan's cost-versus-cash curve |

AG Studio 2.1 supports custom agents whose tools array is a hard capability boundary, plus delegation between agents and Studio actions exposed as tools for your own loop ([AG Studio 2.1](https://blog.ag-grid.com/whats-new-in-ag-studio-2-1-javascript-embedded-analytics/), [AG Studio AI](https://ag-grid.com/studio/react/ai.md)). The sponsor page also offers a boilerplate with AG Studio and PayPal preconfigured ([AG Grid track](https://paypalaihackathon.devpost.com/details/aggrid)).

**Licence timing:** the trial is 45 days and must stay active until winners are announced (21 Dec 2026). Starting it on or after 9 Nov covers that (about 24 Dec).

## System architecture

```text
Owner web app (Goal bar, Workbench/AG Grid, Negotiation Room, Cash Studio/AG Studio) --> AI roles (LLM)
Client agent desk (Payables Desk, policy) -----------------------------------------> Policy layer
Human client (Offer page, PayPal email) ---------------------------------------------> Deal engine

Terms API on Render:
  AI roles (LLM: parse, explain, negotiate) --> Planner (deterministic) --> Policy layer (limits in code)
  Policy layer --> Deal engine (state machine, PayPal writes)
  Webhook receiver (verify, dedupe, update) --> Deal engine ; Webhook receiver --> Postgres + audit log
  AI roles --> LLM provider

PayPal sandbox:
  Transaction Search --> Planner
  Deal engine --> Orders + Vault
  Deal engine --> Invoicing v2
  Webhooks --> Webhook receiver
```

Both agents' moves and every owner edit pass the policy layer before the deal engine writes to PayPal. Transaction Search feeds the planner, and only verified webhooks advance a deal to paid. Live updates reach the screens over server-sent events from the API.

## Data model and backend API

Terms keeps its own records of goals, plans, deals and audit history, and mirrors PayPal objects (invoices, payments, webhook events) with their PayPal IDs. PayPal stays authoritative for money; the mirror is refreshed from webhooks and server reads.

### Tables (Prisma)

| Table | Key fields |
| --- | --- |
| Business | id, name, role (SUPPLIER / CLIENT), paypalEmail, paypalMerchantId, hasAgent |
| SupplierPolicy | businessId, maxDiscountPct, doNotContact\[\], bufferPct, costCeiling, tone |
| ClientPolicy | businessId, hurdleRatePct, cashBuffer, autoPayLimit, earlyPayCapPerDeal, neverPayEarly\[\] |
| Invoice | id, paypalInvoiceId, supplierId, clientId, number, amount, currency, dueDate, paypalStatus, amountPaid, contactAllowed, lastSyncedAt |
| CashEvent | businessId, date, amount, direction, kind (payroll, rent, …), source (PAYPAL\_TXN / CONFIRMED\_RECURRING), paypalTxnId |
| Goal | id, supplierId, rawText, amount, deadline, maxDiscountPct, doNotContact\[\], bufferPct, status |
| Plan | id, goalId, status (DRAFT / APPROVED / MET / CANCELLED), costCeiling, approvedAt |
| PlanItem | planId, invoiceId, action, discountPct, amountEarly, cost, committedIfAgreed, rank (PRIMARY / BACKUP), reason |
| Deal | id, planItemId, state (see Deal states), agreedTerms, paypal refs |
| NegotiationMessage | dealId, from, to, type, terms, note, policyChecks, round, expiresAt |
| Approval | id, subjectType, subjectId, requestedFrom (OWNER / CLIENT\_HUMAN), decision, decidedAt |
| VaultToken | clientId, paypalPaymentTokenId, status |
| PaymentRecord | dealId, paypalOrderId, captureId, invoicePaymentId, amount, status |
| WebhookEvent | paypalEventId (unique), type, verified, payload, receivedAt, processedAt |
| AuditLog | at, actor (OWNER / SUPPLIER\_AGENT / CLIENT\_AGENT / SYSTEM / PAYPAL), action, subject, details, paypalDebugId |

All money is stored as decimal strings or integer cents, never floats.

### Endpoints

| Method and path | Purpose |
| --- | --- |
| `POST /api/sync` | Import invoices and transactions from PayPal |
| `GET /api/invoices` | Workbench rows |
| `GET /api/runway` | Cash runway before and after the plan |
| `POST /api/goals` | Parse the owner's sentence into a goal (returned for confirmation) |
| `PATCH /api/goals/:id` | Owner edits parsed fields |
| `POST /api/goals/:id/plan` | Run the planner; returns the plan with reasons |
| `PATCH /api/plans/:id/items/:itemId` | Owner edits a row (validated against policy) |
| `POST /api/plans/:id/approve` | Approve the plan and its cost ceiling; starts execution |
| `GET /api/deals/:id` | Deal state and transcript |
| `GET /api/approvals` and `POST /api/approvals/:id` | Owner and client-human approvals |
| `GET /api/client/offers` and `PUT /api/client/policy` | Client Payables Desk |
| `POST /api/client/vault/setup` and `POST /api/client/vault/confirm` | Save the client's PayPal method (one human approval) |
| `GET /offer/:token`, `POST /offer/:token/reply` | Public offer page for human clients and their free-text replies |
| `POST /api/webhooks/paypal` | Receive, verify, store and process PayPal events (idempotent on event ID) |
| `GET /api/audit` | Audit trail |
| `POST /api/studio/turn` | Rate-limited LLM proxy for the AG Studio cash-strategist agent (read-only data tools) |
| `GET /api/stream` | Server-sent events for live grid and negotiation updates |

All request bodies are validated with zod. Owner and client routes are separated by a demo session per business, and the public offer page uses a single-use signed token.

## Tech stack, repo and security

It's a TypeScript monorepo with a React frontend and an Express backend, deployed to Render.

| Layer | Choice |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS; AG Grid Enterprise, AG Charts, AG Studio |
| Backend | Node.js, Express, TypeScript, zod |
| Database | PostgreSQL everywhere through Prisma: Render Postgres in production, Docker Compose locally, a Postgres service container in CI |
| AI | Vercel AI SDK; provider decided in Open decisions; PayPal Agent Toolkit |
| PayPal | `@paypal/paypal-server-sdk` (Orders, Vault), REST (Invoicing, Transaction Search, Webhooks) |
| Live updates | Server-sent events |
| Hosting | Render: one web service (API + built frontend) + Postgres; paid instance so it doesn't sleep before 21 Dec |
| Build tooling | Claude Code with the APIMatic Context Plugin for PayPal and AG Grid's agent skills |
| Licence | MIT, visible in the GitHub About section |

### Repo layout

```text
terms/
  apps/web/            React app (Workbench, Negotiation Room, Payables Desk, Offer page, Cash Studio)
  apps/api/            Express API, deal engine, planner, agents, PayPal client, webhook handler
  packages/shared/     Types, zod schemas, money maths, policy checks (shared by both apps)
  prisma/              Schema and migrations
  scripts/seed-sandbox.ts   Creates the demo invoices, transactions and client setups in PayPal sandbox
  docs/                Architecture, API, PayPal integration, AI architecture, judging map
  .env.example
  LICENSE
  README.md
```

### Environment variables (`.env.example`)

`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox`, `PAYPAL_WEBHOOK_ID`, `DATABASE_URL`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MODEL_FAST`, `VITE_AG_GRID_LICENSE_KEY` (frontend; AG Grid licence keys are designed to be public), `APP_BASE_URL`, `SESSION_SECRET`, `OFFER_TOKEN_SECRET`.

### Security

- Secrets live only in server environment variables, never in the frontend or the repo; there is a pre-commit check for keys.
- Every webhook is verified with PayPal's signature-verification API before it is acted on. Duplicates are ignored by event ID.
- The frontend never sends or sets payment state; it only shows what the server confirmed.
- Every PayPal write sends a `PayPal-Request-Id` for idempotency.
- Public offer links are single-use signed tokens with an expiry.
- The public demo has a rate limit on AI calls.
- Audit logs record PayPal debug IDs and never contain secrets or tokens.

## Demo scenario, seed data and video

The demo is one real, reproducible sandbox run: Maya's 3-person design studio closes a $6,200 payroll gap in a day for $61 in discounts, without contacting two protected clients. All figures below follow from the planner rules and the formulas in Actions and planner. In the recording the app computes them live.

### Starting position

The seed script creates every date relative to the day it runs ("Friday" = the next Friday; due dates = today + N days), so the demo always works.

Maya's sandbox balance is $5,200 (set when the sandbox account is created, or brought to that level by the seed script) and payroll of $11,400 is due Friday, a gap of $6,200. With a 5% buffer the target is $6,510. Her goal: max 1.2% discount, don't contact Pinecrest or Birch, plan cost ceiling $60.

| Client | Invoice | Amount | Due | Agent? | Client policy | Contact? |
| --- | --- | --- | --- | --- | --- | --- |
| Juniper Labs | #1041 | $5,000 | in 18 days | Yes | Hurdle 12%/yr, target 20%/yr, auto-pay limit $3,000 | Yes |
| Harbor & Co | #1043 | $7,500 | in 24 days | Yes | Hurdle 15%/yr, target 23%/yr, auto-pay limit $2,000, early-pay cap $5,000 | Yes |
| Oak Street Bakery | #1038 | $1,800 | 6 days overdue | No (human) | — | Yes |
| Pinecrest Dental | #1039 | $2,000 | in 9 days | No | — | **No** |
| Birch Legal | #1042 | $1,200 | in 15 days | No | — | **No** |

Total owed: $17,500.

### What happens

1. **Plan** (cheapest cover of $6,510 at the 0.8% opening discount is $6,750 of invoices pulled forward; of the tied options, this one has the fewest partials and the fewest dollar-days):
   1. Reminder to Oak Street: free, not counted.
   2. Juniper: full $5,000, opening at 0.8%.
   3. Harbor: partial $1,750, opening at 0.8%.
   4. Pinecrest and Birch are shown greyed out, "do not contact".
2. **Juniper's agent** accepts 0.8%. That works out to 16.4% a year, above its 12% hurdle. The $4,960 payment is above Juniper's $3,000 auto-pay limit, so a person at Juniper approves it in PayPal.
3. **Harbor's agent** declines 0.8%, because 12.3% a year is below its 15% hurdle, and counters at 1.5% (the discount that reaches its 23% target rate).
   1. Maya's agent is blocked by policy: 1.5% is above Maya's 1.2% maximum, so its answer is a counter at 1.2%.
   2. That counter would raise plan cost to $61, $1 over the $60 ceiling, so a NEEDS\_OWNER card appears first. Maya approves, and the counter is sent.
4. **Harbor accepts** 1.2%: 18.5% a year, above its hurdle.
5. **Settlement:**
   1. Juniper's invoice: discount $40, then paid $4,960, status PAID.
   2. Harbor's invoice: discount $21 and a partial-payment minimum of $1,729. Harbor's agent pays $1,729 from its saved PayPal method, status PARTIALLY\_PAID, with $5,750 still due on the original date.
   3. Both are confirmed by verified webhooks.
6. **Goal met:** committed cash is $6,689 against the $6,510 target, so Maya's balance covers payroll with $489 to spare. The total discount cost is $61. Oak Street's reminder stays as best effort.

### Demo story (reference for UI decisions; the video itself is made later by the team)

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:07 | Workbench, runway dipping below a red payroll line. Maya types: "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch." | "Maya has to make payroll on Friday. Watch her agent find the money." |
| 0:07–0:20 | Goal chips appear; the forecast confirms the gap from her PayPal history | "59% of US small businesses have invoices more than 30 days overdue. Maya is owed $17,500. Terms turns her deadline into a plan, using PayPal." |
| 0:20–0:38 | Plan rows fill the AG Grid: Oak Street reminder (free, not counted), Juniper 0.8%, Harbor $1,750 at 0.8%, two clients greyed out. Maya clicks **Approve plan** | "It spends as little as possible: reminders first, small discounts only where needed, and never the clients she protected. Nothing goes out until she approves." |
| 0:38–1:05 | Negotiation Room. Juniper's agent: accept, 16.4%/yr. Harbor's agent: "0.8% is below our 15% hurdle. Counter: 1.5%." Policy badge on Maya's side: **blocked, above 1.2% max**. Maya's agent prepares a 1.2% counter | "Her clients have agents too, with their own rules. They negotiate, and neither side can break its policy, because the limits are checked in code, not left to the model." |
| 1:05–1:13 | NEEDS\_OWNER card: "+$1 over your $60 ceiling". Maya taps Approve; the counter goes out and Harbor accepts at 18.5%/yr | "Anything over her approved budget comes back to her." |
| 1:13–1:40 | Juniper's person approves in the PayPal sandbox; Harbor's agent pays $1,729 from its saved PayPal method. API chips show the PayPal calls. Sandbox invoices show the discounts and then PAID / PARTIALLY\_PAID. Webhooks land, verified, in the audit trail | "Every deal is a real PayPal invoice: updated, paid and confirmed by a verified PayPal webhook. The AI never decides that money arrived; PayPal does." |
| 1:40–1:55 | Oak Street's owner replies to the PayPal reminder: "Can pay half Monday." It is parsed to "$900 on Monday" and marked "best effort, goal already met" | "Clients without an agent can just reply in plain English." |
| 1:55–2:10 | Cash Studio: "What if I cap discounts at 1.0% next month?" A widget is built live | "Maya can ask her cash questions in plain English, too." |
| 2:10–2:25 | Scale shot: 30 invoices across 12 clients negotiating at once (sped up, labelled) | "One invoice or a hundred." |
| 2:25–2:50 | Runway back above the payroll line. Outcome card: $6,689 committed in a day, $61 cost, clients earning 16–18% a year, Pinecrest and Birch never contacted | "Payroll covered for $61. Her clients earned more than any savings account. Net 30 was a rule from the paper era; Terms makes it a negotiation." |

## Build plan, spikes and tests

Build order follows risk. The PayPal spikes come first, because two of them can change the design. The UI is built on top of a backend that already moves sandbox money correctly.

### First spikes (before any UI)

| # | Question | Pass condition | Fallback if it fails |
| --- | --- | --- | --- |
| S1 | Can a *sent* invoice be fully updated with a discount and a partial-payment minimum? | `PUT` succeeds; the payer sees the new total and minimum | Cancel and reissue with the agreed terms; link both in the audit trail |
| S2 | Can an agent pay an invoice programmatically (vault order to Maya, then record the payment against the invoice)? | Invoice becomes PAID or PARTIALLY\_PAID with the PayPal transaction ID | A person pays every invoice on PayPal's hosted page; agent auto-pay dropped from the demo |
| S3 | Which webhook events fire for invoice payment and capture in sandbox, and does verification pass? | Events received and verified | Server-side status polling as a backup trigger |
| S4 | Does Transaction Search return the seeded history in time? | Seeded payments appear in the query | Forecast built from Terms' own ledger of verified sandbox transactions |
| S5 | Does vault setup for a PayPal wallet work in sandbox for the client account? | Payment token created after one approval | Same as S2 fallback |
| S6 | AG Studio custom agent with our LLM | Agent builds a widget from a prompt with restricted tools | AG Grid + AG Charts only; drop Cash Studio |

### Phases and owners

1. **Spikes** (A: S1–S5, B: S6) with throwaway scripts; results recorded in `docs/progress-core.md` / `docs/progress-web.md`.
2. **Project setup** (A): monorepo, TypeScript, lint, format, Vitest, Prisma, `.env.example`, MIT licence, CI (typecheck, lint, test). Then `packages/shared` and tag `contracts-v1`.
3. **Backend core** (A): data model, PayPal client with idempotency, sync, webhook receiver with verification, audit log.
4. **Money logic** (A): decimal money maths, policy checks, planner (exact search), deal state machine, all with unit tests.
5. **AI** (A): goal parser, flow labeller, plan explainer, message writer, two negotiators, reply parser, all typed; negotiation simulator.
6. **Settlement** (A): invoice update, reminders, vault setup, agent payment, record payment, end-to-end in sandbox.
7. **API and live updates** (A): every endpoint in the Endpoints table plus server-sent events, with integration tests.
8. **Design system and app shell** (B), then **screens** (B): Workbench, Negotiation Room, Approvals, Payables Desk, Offer page, Audit trail, Connect, Settings.
9. **AG Studio Cash Studio** (B, using A's `/api/studio/turn`).
10. **Seed script and demo mode label** (A).
11. **End-to-end testing** (A and B together on `develop`): the demo scenario from a fresh seed, three clean runs, plus Playwright tests against the real sandbox-backed API.
12. **Deploy** (A) to Render on a paid instance; verify webhooks against the hosted URL.
13. **Docs** (A: technical; B: README product sections, user guide, judging map, Devpost text).

### Test plan

Each feature is marked PASS (actually tested successfully), PARTIAL (works with stated limits) or FAIL. Nothing is marked PASS without evidence (a test run, sandbox IDs or a screenshot).

| Feature | Status | Evidence required |
| --- | --- | --- |
| Import invoices and transactions from PayPal | Not yet tested | Row counts match sandbox |
| Goal parsing (20 phrasings) | Not yet tested | Test report |
| Planner: lowest cost, respects all limits, stop rule | Not yet tested | Unit tests, including do-not-contact |
| Owner plan approval and NEEDS\_OWNER flow | Not yet tested | E2E run |
| Agent negotiation, 0 policy violations in 50 simulated runs | Not yet tested | Simulator report |
| Reply parser, including prompt-injection replies | Not yet tested | Test report |
| Invoice full update (discount, partial minimum) | Not yet tested | Sandbox invoice IDs |
| Reminder sent | Not yet tested | Sandbox invoice activity |
| Vault setup and agent payment | Not yet tested | Order and capture IDs |
| Webhook verification and idempotency | Not yet tested | Verified and duplicate events in the log |
| Runway updates from confirmed payments only | Not yet tested | E2E run |
| AG Studio what-if widget | Not yet tested | Screen recording |
| Hosted deployment stays up | Not yet tested | Uptime check through 21 Dec |

## Submission, judging and sponsor checklists

Stage One is pass/fail on a working build, a public open-source repo and a public video, so those come first. The judging map shows where each criterion's points come from.

### Submission checklist

- [ ] Public GitHub repo with all source, assets and run instructions
- [ ] MIT `LICENSE`, visible in the repo's About section
- [ ] README: problem, demo link, video link, setup, sandbox test accounts for judges, architecture, PayPal APIs used, AI tools and how each is used, limitations, spike results
- [ ] `.env.example`; no secrets anywhere in the history
- [ ] Hosted demo URL on Render, live until 21 Dec 2026, with sandbox credentials in the testing instructions
- [ ] Demo video under 3:00, public on YouTube, shows the hosted app running
- [ ] Devpost text description, "Built With" naming PayPal APIs, AI models, AG Grid, APIMatic and Render
- [ ] AI disclosure: models used and for what; Claude Code used to build
- [ ] Teammate invited and accepted on Devpost
- [ ] Sponsor tools selected on the submission form

### Judging map

| Criterion | Where its points come from |
| --- | --- |
| Technological Implementation | Invoice mutation, vault payments, verified webhooks, Transaction Search, Agent Toolkit; typed agents behind a policy layer; exact planner; negotiation simulator |
| Design | A Workbench and Negotiation Room that read as a real product; complete loading, empty, error and pending states; no dead buttons |
| Potential Impact | QuickBooks and Xero data on late payment; a concrete owner (payroll Friday); both sides gain (cash today vs a 16–18% return) |
| Innovation | Two-agent negotiation of payment terms for small businesses, which JPMorgan calls prospective; goal-driven, spends only what is needed |
| Presentation | Hook in 7 seconds, negotiation by 0:38, PayPal proof on screen, outcome in numbers |

### Sponsor checklist

| Sponsor | Requirement | How Terms meets it | Shown in video |
| --- | --- | --- | --- |
| AG Grid (main target) | Use AG Grid; judges want polish and the Studio agent framework | Workbench grid, AG Charts runway, AG Studio custom agent | 0:20–0:38 and 1:55–2:10 |
| APIMatic | Context Plugin used to build the PayPal integration; claim form on the sponsor page | Claude Code with the plugin loaded; README section | No (build-time tool) |
| Render | Hosted on Render | Web service + Postgres | Hosted URL visible |

A project can win at most one sponsor prize, plus either one grand prize or one honorable mention.

## Defaults (until the team says otherwise)

- **LLM provider:** configurable through `LLM_PROVIDER` and `LLM_API_KEY` using the Vercel AI SDK. Default: a top-tier tool-calling model (Claude Sonnet-class) for the two negotiators, goal parser and reply parser; a cheaper model (`LLM_MODEL_FAST`) for explanations and message drafting. Rate-limit AI calls on the public demo.
- **Accounts needed:** PayPal Developer sandbox (one REST app owned by the Maya Studio business account, plus the demo accounts listed in Sandbox setup), an LLM API key, Render, an AG Grid trial licence key. If a credential is missing, add it to `.env.example`, say exactly what is needed, and continue with work that doesn't depend on it.
- **If spike S2 fails** (agent cannot pay an invoice programmatically): every payment is approved by a person on PayPal's hosted invoice page; the negotiation stays the centrepiece.
- **Name:** Terms.

## Sources

Hackathon: [overview](https://paypalaihackathon.devpost.com/), [rules](https://paypalaihackathon.devpost.com/rules), [dates](https://paypalaihackathon.devpost.com/details/dates), [resources](https://paypalaihackathon.devpost.com/resources), [FAQs](https://paypalaihackathon.devpost.com/details/faqs), [updates](https://paypalaihackathon.devpost.com/updates), [AG Grid track](https://paypalaihackathon.devpost.com/details/aggrid), [APIMatic track](https://paypalaihackathon.devpost.com/details/apimatic).

PayPal:

- [Invoicing API v2](https://developer.paypal.com/docs/api/invoicing/v2/)
- [Invoicing integration (partial payments, discounts)](https://docs.paypal.ai/growth/grow-business/invoicing/integrate)
- [Invoicing reference (full update, record payment)](https://docs.paypal.ai/growth/grow-business/invoicing/reference)
- [Agent Toolkit](https://github.com/paypal/agent-toolkit/)
- [APIMatic Context Plugin for PayPal](https://developer.paypal.com/community/blog/A%20New%20Context%20Plugin%20for%20AI-Assisted%20Coding%20with%20PayPal%20SDKs)

Market:

- [QuickBooks 2026 Late Payments Report](https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2026/)
- [Xero Q2 2026 payment times (ABC17)](https://abc17news.com/?p=1641455)
- [Ntropy on early-payment discounts](https://www.ntropy.com/blog/build-ai-supplier-payment-agent)
- [PYMNTS on agent-negotiated terms (JPMorgan)](https://www.pymnts.com/?p=4224575)
- [QuickBooks Payments Agent](https://www.cpapracticeadvisor.com/2025/06/27/intuit-rolls-out-ai-agents-for-quickbooks/163868/)
- [Sage Payments Agent](https://beancount.io/blog/2026/11/03/sage-copilot-payments-agent-sole-trader-invoice-chasing-freelancer-guide)
- [Spendflo payment terms agent](https://www.spendflo.com/agents/ai-payment-terms-negotiation-agent)

AG Grid: [AG Studio 2.1](https://blog.ag-grid.com/whats-new-in-ag-studio-2-1-javascript-embedded-analytics/), [AG Studio AI](https://ag-grid.com/studio/react/ai.md).
