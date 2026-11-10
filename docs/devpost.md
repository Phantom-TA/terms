# Devpost submission text

## Tagline

Net 30 is a rule from the paper era. Terms makes it a negotiation.

## Inspiration

In 2026, 59% of US small businesses had invoices more than 30 days overdue, and the average business
waiting on invoices was owed $17.7K. The usual fix is chasing. But the client on the other side would
often welcome a fair price for paying early: 2% off a net-30 invoice is a return of about 36% a year.
It almost never happens, because nobody has time to negotiate it. Payment agents today chase invoices
for one side. We wanted agents that negotiate, for both sides, within rules each business sets.

## What it does

A small-business owner says what she needs in one sentence: "I need $6,200 by Friday. Max 1.2%.
Don't contact Pinecrest or Birch." Terms checks the gap against her PayPal history, then plans the
cheapest way to close it: a free reminder first, small early-payment discounts only where needed,
and never the clients she protected. Nothing is sent until she approves.

Where a client runs its own Terms agent, the two agents negotiate. Each checks every move against its
own business's policy in code: her maximum discount and cost ceiling, the client's hurdle rate, cash
buffer and auto-pay limit. Anything that would cost more than the approved plan comes back to her.
Clients without an agent get a one-page offer, or can reply in their own words.

Every deal is a real PayPal invoice. Agreed terms are written onto it, the client's agent pays from a
saved PayPal method or a person pays on PayPal, and the deal counts as paid only when PayPal's
verified webhook says so.

In the demo, Maya covers a $6,200 payroll gap in a day for $61 in discounts, and her clients earn
16–18% a year for paying early.

She can also ask what-if questions in Cash Studio, where an AG Studio agent answers with charts it
builds live and cannot change anything.

## How we built it

- **PayPal:** Invoicing (full update with a discount and partial-payment minimum, reminders), Vault
  and Orders for agent payments, verified webhooks, and Transaction Search for the cash history.
- **AI:** a goal parser, a negotiator for each side, a reply parser for clients who answer in words,
  explanations, and the Cash Studio strategist. A model chooses and words a move; code decides
  whether it is allowed. The browser never holds a model key.
- **AG Grid:** the Workbench, the client's Payables Desk and the audit trail are AG Grid Enterprise
  grids. The cash runway is AG Charts. Cash Studio is AG Studio, with a custom agent whose tools
  array is a hard boundary and a custom cost-versus-cash widget.
- **APIMatic:** the PayPal integration was built with the APIMatic Context Plugin loaded in Claude
  Code.
- **Stack:** React, TypeScript, Vite and Tailwind; a Node and Express API with Postgres and Prisma; one typed
  contract package shared by both, checked on every request and response. Hosted on Render.

## Challenges we ran into

- **Two agents sharing one deal, each with private rules.** Both sides read the same conversation,
  but each may see only its own policy, checks, reasons and approvals. We made that a server rule
  for every view, audit entry and live update.
- **Money is PayPal's word, not the model's.** A deal is never shown as paid until a verified webhook
  arrives, and the interface shows "waiting for PayPal confirmation" until then.
- **The sandbox's own limits.** Reporting lags by about two hours, so the forecast also uses
  payments Terms has verified itself.
- **An AI agent in a dashboard that cannot do harm.** In AG Studio, the cash strategist's tools are
  limited to reading data and building widgets. Its model runs on our server.

## Accomplishments that we're proud of

- Two agents negotiate real payment terms, end to end on PayPal, and neither can break its own
  business's limits.
- A finance desk that reads as a real product: every screen has loading, empty, error and pending
  states, works on laptop and tablet, and is checked for accessibility, including keyboard-only use.

## What we learned

Agent-to-agent commerce needs more than a good model. It needs both sides' rules enforced in code, a
neutral record each side can trust, and a payment network that confirms the money moved.

## What's next

- Recurring goals ("keep a month of payroll in the bank").
- More negotiation levers: instalments, and longer terms in exchange for a deposit.
- Clients' agents that negotiate across several suppliers at once.

## Built with

PayPal Invoicing API, PayPal Orders API, PayPal Vault, PayPal Webhooks, PayPal Transaction Search,
Claude, Vercel AI SDK, AG Grid Enterprise, AG Charts, AG Studio, APIMatic Context Plugin, React, TypeScript, Vite,
Tailwind CSS, Node.js, Express, PostgreSQL, Prisma, Render.

## AI disclosure

The goal parser, the negotiators, the reply parser, the explanations and the Cash Studio strategist
run on Claude models by default, through the Vercel AI SDK (the provider is configurable);
[docs/ai.md](ai.md) lists which model does what. The code was written with Claude Code.
