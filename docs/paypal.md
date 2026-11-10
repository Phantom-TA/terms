# PayPal integration (Developer A)

How Terms uses PayPal, and what the sandbox spikes established. The contract sheet for the SDK
calls is [`paypal-plan.md`](../paypal-plan.md) at the repo root.

## Carriers

| PayPal surface                    | How Terms calls it                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Orders, Vault, Transaction Search | APIMatic Context Plugin's TypeScript SDK (`paypal`, pinned commit), built with the plugin loaded in Claude Code |
| Invoicing, Webhooks, Payouts      | `PayPalRestClient` (`apps/api/src/paypal/rest-client.ts`), because the SDK has no such resources                |

Every PayPal write is claimed in the `PayPalWrite` ledger before it is sent and carries the claim's
`PayPal-Request-Id`. Every failure goes through one classification (`apps/api/src/paypal/errors.ts`).

## Services

| Service    | File                                     | What it does                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invoices   | `apps/api/src/paypal/invoice-service.ts` | `applyTerms` puts an AGREED deal's discount and partial minimum on its SENT invoice (full update) → AWAITING_PAYMENT. `remind` sends a reminder after re-checking do-not-contact. `recordPayment` links an agent's capture to the invoice, falling back to an external payment carrying the capture id |
| Vault      | `apps/api/src/paypal/vault-service.ts`   | `startSetup` returns the approval link for the client's person. `completeSetup` exchanges an APPROVED setup token for a payment token                                                                                                                                                                  |
| Payments   | `apps/api/src/paypal/payment-service.ts` | `payWithVault`: the client's agent pays the exact agreed amount to the app owner from its own token. Above the auto-pay limit it needs an approved CLIENT_PAYMENT                                                                                                                                      |
| Settlement | `apps/api/src/paypal/settlement.ts`      | The only code that marks a deal PAID or PARTIALLY_PAID, from a capture or from the invoice as PayPal holds it                                                                                                                                                                                          |
| Webhooks   | `apps/api/src/paypal/webhook-service.ts` | Verifies each delivery (PayPal's API, or locally if it is down), stores it once by event id, then settles. Rejected and duplicate deliveries are audited for the owner. `ensureRegistered` registers the endpoint once                                                                                 |

Every write follows claim → call → record (`WriteLedger`, `sendClaimed`). A lost answer is replayed
with the same `PayPal-Request-Id`, or settled by re-reading the invoice. It is never reported as
failed. The webhook tests run against two **real PayPal-signed sandbox deliveries** captured in
spike S3, with PayPal's public signing certificate (`apps/api/test/fixtures/paypal/`).

## Spike results

### S1: full update of a SENT invoice — PASS (2026-11-10)

`scripts/spikes/s1-invoice-update.ts` created and sent two sandbox invoices from Maya Studio, then
applied the demo's agreed terms with `PUT /v2/invoicing/invoices/{id}?send_to_recipient=true`:

| Invoice                                 | Before          | Terms applied                                                | After (read back)                        |
| --------------------------------------- | --------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Harbor & Co `INV2-4N8K-4NFN-JHYN-FX26`  | $7,500.00, SENT | discount $21.00, partial payments allowed, minimum $1,729.00 | total $7,479.00, minimum $1,729.00, SENT |
| Juniper Labs `INV2-V8DF-9KKR-9FR3-REUZ` | $5,000.00, SENT | discount $40.00                                              | total $4,960.00, SENT                    |

The payer's page for Harbor (`detail.metadata.recipient_view_url`) shows "$7,479.00", "Minimum due:
$1,729.00" and a "Discount −$21.00" line. The cancel-and-reissue fallback is not needed.

What the integration must do, learned from the spike:

- **Send the recomputed total.** A PUT that changes the discount but leaves `amount.value` at the old
  total is refused with `400 INVALID_REQUEST`, `calculation_error` on `/amount/value`. The update
  sets `amount.value` = item total − discount.
- **Discounts read back negative.** PayPal stores `invoice_discount.amount.value` as `"-21.00"`. An
  update always writes the agreed discount fresh, as a positive amount, and never re-sends what it
  read.
- **Set the invoicer's business name.** Without it the payer sees "Test Store". The seed script sets
  `invoicer.business_name` to "Maya Studio".
- The create call answered with the full invoice under `Prefer: return=representation`. The send call
  needs no body beyond `send_to_recipient`.

### S3: webhook events and verification — PASS (2026-11-10)

`scripts/spikes/s3-webhook-receiver.ts` ran behind a temporary `cloudflared` tunnel.
`scripts/spikes/s3-webhooks.ts` registered it for the 28 sandbox event types under `INVOICING.*`,
`PAYMENT.CAPTURE.*`, `CHECKOUT.ORDER.*` and `VAULT.*`, triggered real events, and deleted the
registration afterwards.

| What happened                                  | Event received (within ~30 s)                                                                                     | API verify | Local verify |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| Full update of a SENT invoice                  | `INVOICING.INVOICE.UPDATED`, `resource.invoice.status = SENT`                                                     | SUCCESS    | SUCCESS      |
| $1.00 vault-funded order (completes at create) | `PAYMENT.CAPTURE.COMPLETED`, carrying our `custom_id`, `invoice_id` and `supplementary_data.related_ids.order_id` | SUCCESS    | SUCCESS      |
| PayPal re-delivery of that event (`/resend`)   | the same event id again                                                                                           | SUCCESS    | SUCCESS      |
| $100 recorded on a $4,960 invoice              | `INVOICING.INVOICE.PAID`, `resource.invoice.status = PARTIALLY_PAID`, $4,860 due                                  | SUCCESS    | SUCCESS      |

Design consequences:

- **There is no PARTIALLY_PAID event type.** `INVOICING.INVOICE.PAID` is documented as "paid,
  partially paid, or payment is made and is pending". The deal engine reads
  `resource.invoice.status` (and `payments.paid_amount`, `due_amount`) to choose PAID or
  PARTIALLY_PAID, never the event name alone.
- **A vault order emits no `CHECKOUT.ORDER.*` event.** It completes at create, so
  `PAYMENT.CAPTURE.COMPLETED` is the settlement signal for agent payments. The capture's
  `custom_id` is the Terms deal id, which identifies the deal.
- **Re-deliveries reuse the event id**, so a unique `WebhookEvent.paypalEventId` makes processing
  idempotent.
- **Both verification methods pass.** One is PayPal's `verify-webhook-signature` API, sent the
  parsed event. The other is local: CRC32 of the raw body, `transmission_id|time|webhook_id|crc`,
  checked with SHA256withRSA against the PayPal certificate, fetched only from a `paypal.com` host.
  The receiver uses the API, as CONTEXT.md says, and keeps the raw body so the local check is
  available if the API is unreachable.
- Delivery took between 10 and 30 seconds. The UI shows "waiting for PayPal confirmation" in
  between.

### S5: vault setup for a client's PayPal wallet — PASS (2026-11-10)

`scripts/spikes/s5-vault-setup.ts` (APIMatic SDK, `client.vault`):

1. `createSetupToken` with `payment_source.paypal.usage_type = MERCHANT` and return/cancel URLs gave
   setup token `6JH89326GG397024C`, status `PAYER_ACTION_REQUIRED`, and an `approve` link.
2. A person at Harbor & Co signed in to the sandbox and approved once. PayPal then redirected to our
   return URL.
3. `getSetupToken` read `APPROVED`. `createPaymentToken` with
   `{ token: { id, type: "SETUP_TOKEN" } }` returned payment token `4hw33165rx315042p` for PayPal
   customer `OUuVhqZgCu` (`harbor@terms-demo.example.com`).

### S2: agent payment from the saved method — PARTIAL (2026-11-10)

`scripts/spikes/s2-agent-payment.ts pay`:

| Step                                                                                                                   | Result                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `orders.createOrder` $1,729.00, `payment_source.paypal.vault_id`, `PayPal-Request-Id`, `Prefer: return=representation` | Order `2XX2750553613410D`, **COMPLETED at create**, capture `34782754WR027910H` COMPLETED $1,729.00 |
| `orders.captureOrder`                                                                                                  | Not needed: a vault order is single-step                                                            |
| Replay of the create with the same `PayPal-Request-Id`                                                                 | Returned the **same order**; no second charge                                                       |
| `POST /v2/invoicing/invoices/{id}/payments` with `method: PAYPAL`, `payment_id` = capture id                           | **404 RESOURCE_NOT_FOUND**, three tries over 10 minutes                                             |

The money moved: the capture completed and PayPal holds it. A fourth try, about 15 minutes after
the capture, was still refused. What is still open is linking that
capture to the invoice. At the time of the tries, PayPal's reporting data was last refreshed two
hours before the capture (see S4). The likely cause is that Invoicing cannot find a PayPal
transaction until reporting has it. `s2-agent-payment.ts record 2XX2750553613410D` retries the link
once reporting catches up. Its outcome decides the design:

- If the PayPal-method record works after the lag, the deal engine records it on a schedule. The
  deal still moves to PARTIALLY_PAID only on the verified `PAYMENT.CAPTURE.COMPLETED` webhook or a
  server read, never on the record call.
- If it never works for vault captures, record the payment as an external one (`method: OTHER`,
  with the capture id in the note) straight after capture. The capture id stays in Terms' payment
  record and the audit trail.

Also learned:

- The unknown-outcome settlement in paypal-plan.md (replay the create with the stored request id)
  works for orders.
- `purchase_units[].invoice_id` must be unique per merchant, so it carries the invoice number plus
  the deal id. A second order for the same invoice number would otherwise be refused.

### S4: Transaction Search lag — PARTIAL (2026-11-10)

`scripts/spikes/s4-reporting-lag.ts`:

| Measured at (UTC) | `last_refreshed_datetime` | Lag     | Balance (dashboard: $5,200) | S2 capture visible |
| ----------------- | ------------------------- | ------- | --------------------------- | ------------------ |
| 18:3x             | 16:59:59                  | ≈ 1.5 h | 5,000.00                    | —                  |
| 19:05             | 17:29:59                  | ≈ 1.6 h | 5,000.00                    | —                  |
| 19:29             | 17:29:59                  | 119 min | 5,000.00                    | no                 |

Reporting data lags by about two hours and refreshes on a 30-minute cadence. The balance snapshot
predates the sandbox account's opening balance. Consequences for the build:

- The cash position shows PayPal's balance with its `as_of_time`. It adds activity Terms itself
  has verified since then, from webhooks and capture responses (CONTEXT.md's S4 fallback). The
  sandbox lag never hides a payment the demo just made.
- The seed script runs well before the demo, so the history (past payroll payouts) is visible to
  the forecast by then.

More runs will pin down the lag. The next run should show the S2 capture.

## Known SDK drift

Vault error responses (`GET /v3/vault/setup-tokens/{id}`, `GET /v3/vault/payment-tokens/{id}` on an
unknown id) carry `links` items without `rel`, which the SDK's `Error` model requires. The call
therefore rejects with a `DecodeError` on status 404 instead of a typed arm. Terms reads such a
failure by its status (`toAppError` maps it to `NOT_FOUND`).
