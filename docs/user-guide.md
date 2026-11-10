# Terms user guide

Terms has two kinds of user. The **owner** (the supplier) is owed money and needs cash by a date.
A **client** (the payer) is a business that owes the owner. Some clients run their own Terms agent;
others get a link to an offer page.

The banner at the top of every screen says when you are on the PayPal sandbox with demo data. No
real money moves there.

## Choosing who you are

On the first screen, pick the business you are acting as. In the demo:

- **Maya Studio** is the owner.
- **Juniper Labs** and **Harbor & Co** are clients with agents.
- **Oak Street Bakery** is a client without an agent; it gets a reminder.
- **Pinecrest Dental** and **Birch Legal** are clients Maya has protected; they are never contacted.

Switch business at any time from **Acting as** at the top right.

## As the owner

### 1. Workbench: set the goal and approve the plan

1. Type what you need in one sentence, for example: _"I need $6,200 by Friday. Max 1.2%. Don't
   contact Pinecrest or Birch."_ Select **Read my goal**.
2. Check the chips Terms read from it: amount, date, maximum discount, opening discount, buffer and
   who not to contact. Select a chip to change it. A note under the chips names anything your
   sentence didn't say, which Terms took from your policy.
3. Terms checks the gap against your PayPal history and says whether it agrees.
4. Select **Confirm and build plan**. The grid fills with one row per invoice, grouped by action:
   discounts to offer, reminders, nothing to do, and do not contact. Open a row to see why the
   planner chose it.
5. You can change a row's action or discount. Terms checks every change against your limits and
   tells you, beside the row, if one would break them.
6. The top rail shows the gap, what is committed, the plan's cost and your cost ceiling. The runway
   chart shows your balance against the payroll line, before and after the plan.
7. Select **Approve plan**, set your cost ceiling and confirm. Nothing is sent before this. After
   it, the plan is locked and each row shows its deal as it moves.

### 2. Negotiation Room: watch the agents, decide when asked

- The list on the left shows every conversation. The one that needs you comes first.
- Each message shows its terms, what the client would earn a year, and the checks your side ran.
  You never see the client's own limits, and the client never sees yours.
- If a counter would cost more than your approved plan, a **Needs you** card shows what it would
  cost and by how much it goes over. **Approve** sends it; **Reject** closes the deal.
- **Settlement on PayPal** lists each PayPal call. A deal shows as paid only once PayPal confirms it.

### 3. Cash Studio: ask what-if questions

Ask in plain words, or pick a suggestion: _"What if I cap discounts at 1.0% next month?"_ The cash
strategist reads your invoices and runway and builds charts to answer. It can't change your data,
your plan or anything on PayPal. **What early cash costs** draws the plan's rows from the cheapest
cash to the dearest.

### 4. Approvals, Audit trail, Connect & import, Settings

- **Approvals** lists everything waiting for you, and what you decided before.
- **Audit trail** records every step, with PayPal's request and debug IDs and whether each webhook
  was verified. Filter by who acted and what happened.
- **Connect & import** shows the connected PayPal account and imports your invoices.
- **Settings** holds your policy: maximum discount, buffer, cost ceiling and who never to contact.

## As a client with an agent

### Payables Desk

- **Cash available, buffer and can pay early** show what your agent may spend on early payment.
- **Offers** lists suppliers' offers, ranked by what paying early earns you a year, with your
  agent's recommendation and the checks it ran against your policy.
- When a payment is above your auto-pay limit, it waits under **Waiting for a person**. Select
  **Approve payment**: PayPal's invoice opens in a new tab, and you pay there. The desk shows the
  payment as **Waiting for PayPal confirmation** until PayPal confirms it.
- **Your agent's policy** sets your hurdle rate, target rate, cash buffer and auto-pay limit.
- **Saved PayPal method:** save one, and your agent can pay within its auto-pay limit without asking.

## As a client without an agent

You receive a link to an offer page, for example _"Pay $4,960 today instead of $5,000 on the 27th."_

- **Pay now with PayPal** takes the offer as made.
- **Pay part now** lets you choose an amount up to the offer.
- **Not now** declines, and the invoice keeps its original terms.
- You can also reply in your own words, such as _"Can pay half Monday."_ Terms shows how it read
  your reply. A promise in words is treated as best effort, not as agreed.

A used or expired link says so and offers nothing more.

## Keyboard and screen readers

The main flows (goal, plan, approvals and decisions) work from the keyboard alone, and the focused
element always shows. Dialogs keep focus inside and close with Escape. The runway chart and the
cost-versus-cash curve have a written summary for screen readers.
