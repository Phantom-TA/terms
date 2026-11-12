# Judging map

Where each of the PayPal AI Hackathon's five criteria is shown, and how to check it. Screens are in
the [README](../README.md); the web app's test evidence is in [progress-web.md](progress-web.md),
and the server's in [progress-core.md](progress-core.md).

## Technological implementation

| What                                                                                                            | Where to see it                                                                               | How to check it                                                          |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A PayPal invoice is the deal: agreed terms go onto it with a full update (discount and partial-payment minimum) | Negotiation Room, "Settlement on PayPal"; Audit trail                                         | Sandbox invoice IDs in the audit trail; [paypal.md](paypal.md), spike S1 |
| Agents pay from a saved PayPal method; a person approves a payment above the limit                              | Payables Desk                                                                                 | [paypal.md](paypal.md), spikes S2 and S5                                 |
| A deal counts as paid only on a verified PayPal webhook                                                         | Negotiation Room, Payables Desk ("Waiting for PayPal confirmation"), Audit trail ("verified") | [paypal.md](paypal.md), spike S3                                         |
| Limits are enforced in code, for both sides, on every move; the model only chooses and words                    | Policy badges on each message; Needs-you cards                                                | [ai.md](ai.md), "Evidence that a model cannot break a limit"             |
| Each side sees only its own policy, checks and approvals                                                        | Negotiation Room (owner) against Payables Desk (client)                                       | [api.md](api.md), "Visibility on a shared deal"                          |
| One typed contract for the API and the web app; every response is checked against it                            | Every screen                                                                                  | `packages/shared`; [api.md](api.md)                                      |
| AG Studio custom agent through the server, with a tools array as the boundary                                   | Cash Studio                                                                                   | [decisions-web.md](decisions-web.md), W-048 to W-057                     |

## Design

| What                                                                                                                       | Where to see it                                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A calm, document-like finance desk with one accent, kept for cash committed                                                | Workbench, Negotiation Room                                                  |
| Every screen has loading, empty, error (with PayPal's debug ID and retry) and "waiting for PayPal" states; no dead buttons | Every screen; component tests in `apps/web/src`                              |
| Works at laptop (1366×768) and tablet (820×1180) widths without scrolling sideways                                         | Browser tests run at both widths                                             |
| Accessible: axe in every component test and in the browser; keyboard-only flows; a visible focus indicator at every stop   | `apps/web/e2e/keyboard.spec.ts`; [progress-web.md](progress-web.md), Phase 6 |
| State changes are seen as they happen: the pill animates, and AG Grid flashes the changed cell                             | Workbench, Negotiation Room                                                  |

## Potential impact

| What                                                                                              | Where                                          |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 59% of US small businesses had invoices more than 30 days overdue in 2026; $17.7K owed on average | [README](../README.md), "The problem"          |
| A concrete owner: payroll on Friday, $6,200 short                                                 | The demo                                       |
| Both sides gain: the owner gets cash today for $61; clients earn 16–18% a year for paying early   | Workbench outcome; Payables Desk "Your return" |
| Works with clients who run no agent: a one-page offer, or a reply in their own words              | Offer page                                     |

## Innovation

| What                                                                                                | Where                        |
| --------------------------------------------------------------------------------------------------- | ---------------------------- |
| Two agents negotiate payment terms for small businesses, each within its own business's policy      | Negotiation Room             |
| Goal-driven: the plan spends only what the goal needs, reminders first, never the protected clients | Workbench plan               |
| The owner stays in charge: nothing is sent before approval, and anything over budget comes back     | Approve plan; Needs-you card |
| What-if questions answered with charts by an AG Studio agent that cannot change anything            | Cash Studio                  |

## Presentation

| What                                                                   | Where                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| The demo's story, from the goal to "payroll covered for $61"           | [README](../README.md), "The demo, in screens" |
| PayPal proof on screen: invoice IDs, request IDs and verified webhooks | Audit trail                                    |
| A user guide for both kinds of user                                    | [user-guide.md](user-guide.md)                 |
