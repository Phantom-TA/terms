# Demo video: shot list

The video must be under 3:00, public on YouTube, and show the hosted app running. This list turns the
demo story in CONTEXT.md into exact clicks, what must be on screen, and the narration. The figures
are the demo's; if a fresh run shows different ones, use what the run shows.

## Before recording

- **A fresh demo run on the hosted app:** reseed with a new suffix (`pnpm seed --reset --suffix <letter>`).
  Then run `pnpm e2e:real` once against it (see `apps/web/e2e/real/README.md`) and reseed again, so
  the recording starts clean.
- **Two browser windows, side by side at 1366×768 or larger:**
  - window 1 signed in as Maya Studio;
  - window 2 as Juniper Labs.
  - A third tab signed in to the PayPal sandbox as Juniper's person, for paying the invoice.
- **PayPal's webhooks reach the server** (the Render URL is registered), so payments are confirmed on
  screen.
- **An AI key on the server**, for the negotiators' notes and Cash Studio.
- **Notifications:** close any toast before cutting to a new screen.
- **Speed:** waiting on PayPal or the negotiation can be cut or sped up, labelled "sped up".

## Shots

| Time      | Screen                                                      | Do                                                                                                                                                   | Must be on screen                                                                                                                                                                    | Narration                                                                                                                                                                  |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:07 | Workbench (Maya)                                            | Type the goal: "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch."                                                                | The runway below the red payroll line ($11,400, Friday)                                                                                                                              | "Maya has to make payroll on Friday. Watch her agent find the money."                                                                                                      |
| 0:07–0:20 | Workbench                                                   | Select **Read my goal**                                                                                                                              | Goal chips ($6,200, Fri, max 1.2%, target $6,510); "Confirmed from PayPal history"; Pinecrest and Birch under Do not contact                                                         | "59% of US small businesses have invoices more than 30 days overdue. Maya is owed $17,500. Terms turns her deadline into a plan, using PayPal."                            |
| 0:20–0:38 | Workbench                                                   | **Confirm and build plan**; open Harbor's row for "Why this row"; **Approve plan** with a $60 ceiling                                                | Oak Street reminder (best effort, not counted), Juniper $5,000 at 0.8%, Harbor $1,750 at 0.8%, Pinecrest and Birch greyed out; plan cost $54; "Plan approved"                        | "It spends as little as possible: reminders first, small discounts only where needed, and never the clients she protected. Nothing goes out until she approves."           |
| 0:38–1:05 | Negotiation Room                                            | Open it as the plan is approved; select Harbor                                                                                                       | Juniper's agent accepts (16.4% a year); Harbor's counter at 1.5%; Maya's offer with its policy checks                                                                                | "Her clients have agents too, with their own rules. They negotiate, and neither side can break its policy, because the limits are checked in code, not left to the model." |
| 1:05–1:13 | Negotiation Room                                            | On the **Needs you** card, select **Approve**                                                                                                        | "+$1.00 over your ceiling", plan cost $54 → $61; then Harbor accepts at 1.2% (18.5% a year)                                                                                          | "Anything over her approved budget comes back to her."                                                                                                                     |
| 1:13–1:40 | Payables Desk (Juniper), PayPal sandbox, Audit trail (Maya) | As Juniper, **Approve payment**: PayPal's invoice opens; pay it in the sandbox. Back on the desk, wait for the confirmation. Then Maya's Audit trail | The $4,960 approval; PayPal's invoice page; "Waiting for PayPal confirmation", then "Payment confirmed by PayPal"; in the audit trail, the PayPal calls and webhooks marked verified | "Every deal is a real PayPal invoice: updated, paid and confirmed by a verified PayPal webhook. The AI never decides that money arrived; PayPal does."                     |
| 1:40–1:55 | Offer page or Audit trail                                   | Oak Street replies in words: "Can pay half Monday"                                                                                                   | How Terms read it ($900 on Monday), marked best effort                                                                                                                               | "Clients without an agent can just reply in plain English."                                                                                                                |
| 1:55–2:10 | Cash Studio (Maya)                                          | Select the suggestion **Cap discounts at 1.0%**, then **What early cash costs**                                                                      | The what-if runway chart built live; the cost-versus-cash curve                                                                                                                      | "Maya can ask her cash questions in plain English, too."                                                                                                                   |
| 2:10–2:25 | Workbench                                                   | The scale run                                                                                                                                        | Many invoices and clients moving at once, labelled "sped up"                                                                                                                         | "One invoice or a hundred."                                                                                                                                                |
| 2:25–2:50 | Workbench                                                   | Scroll to the top rail and runway                                                                                                                    | Runway back above the payroll line; $6,689 committed, $61 cost; Pinecrest and Birch never contacted                                                                                  | "Payroll covered for $61. Her clients earned more than any savings account. Net 30 was a rule from the paper era; Terms makes it a negotiation."                           |

## Needs A before recording

- **Oak Street's reply (1:40):** in the demo, Oak Street replies to PayPal's reminder. How that reply
  reaches Terms on the real server needs A's answer. The offer page's written reply works today
  for a client with an offer link.
- **The scale shot (2:10):** CONTEXT.md plans a `--scale` seed (30 invoices across 12 clients), but
  A's seed script has no such option yet. The web app was tested with 300 extra invoices in mock mode
  (`apps/web/e2e/scale.spec.ts`).
- **The payment confirmation (1:13):** needs the webhook registered for the hosted URL.

## If something goes wrong while recording

| Problem                                 | What to do                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The Needs-you card takes long to appear | Cut the wait; label the cut                                                                                         |
| PayPal's confirmation does not arrive   | Check the webhook registration; the deal stays "waiting for PayPal confirmation", which is correct but not the shot |
| Cash Studio says it isn't available     | The server has no AI key; set `LLM_API_KEY` and restart                                                             |
| A figure differs from this list         | Use the run's figure in the narration; the app computes it live                                                     |
