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

### S2–S5

Not run yet.

## Known SDK drift

Vault error responses (`GET /v3/vault/setup-tokens/{id}`, `GET /v3/vault/payment-tokens/{id}` on an
unknown id) carry `links` items without `rel`, which the SDK's `Error` model requires. The call
therefore rejects with a `DecodeError` on status 404 instead of a typed arm. Terms reads such a
failure by its status (`toAppError` maps it to `NOT_FOUND`).
