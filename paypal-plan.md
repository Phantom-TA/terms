# PayPal integration plan and contract sheet

Developer A, `a/core`. Written before any PayPal code, as the APIMatic Context Plugin's
`typescript-integrate-paypal` workflow requires. Every SDK fact below comes from the SDK map inside
`apps/api/node_modules/paypal/` (`sdk-map.md`, `map/operations/*.md`, `api-reference.md`) or from a
model file it names. Each row is labelled **map** (looked up), **smoke** (observed against the sandbox
on 2026-11-10), **UNVERIFIED** (says what settles it) or **YOUR CALL** (a decision of ours, with the
reason).

## Scope

The demo's money flows (CONTEXT.md, "PayPal integration"):

1. **Human pays the invoice.** Terms updates the invoice's terms, the client pays on PayPal's page,
   and a verified webhook settles the deal.
2. **Agent pays within its limit.** The client saves its PayPal method once (Vault), and Terms
   charges it with an order to Maya and records the payment against the invoice.
3. **Agent pays above its limit.** Same as 2, after a person at the client approves.

PayPal surfaces in scope, and who carries each:

| Surface                                                                                   | Carrier                        | Why                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Vault setup and payment tokens                                                            | SDK `client.vault`             | map                                                                                                   |
| Orders (agent payment)                                                                    | SDK `client.orders`            | map                                                                                                   |
| Balances and Transaction Search                                                           | SDK `client.transactionSearch` | map                                                                                                   |
| Invoicing (create, send, show, list, search, full update, remind, cancel, record payment) | our REST client                | The SDK has 5 resources, none of them Invoicing (map: `sdk-map.md` Operations table)                  |
| Webhooks (register, list, verify signature)                                               | our REST client                | Not in the SDK. The client-initialization skill says there is no webhook surface on any generated SDK |
| Payouts (seed only: past payroll)                                                         | our REST client                | Not in the SDK                                                                                        |
| OAuth token for the REST client                                                           | our REST client                | The SDK's token cache is private to the SDK client                                                    |

`client.payments` and `client.subscriptions` are out of scope.

## Repo survey

| Fact                       | Value                                                                                                                                                                                                                       | Exemplar to imitate                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Module format              | ESM (`"type": "module"` in `apps/api/package.json`), one dialect, so `instanceof` on SDK errors is reliable                                                                                                                 | `apps/api/src/audit.ts`                  |
| Runtime                    | Node 24 (`.nvmrc`); Express 5 server; no browser use of the SDK                                                                                                                                                             | —                                        |
| Compiler flags that matter | `strict`, `exactOptionalPropertyTypes` (omit absent optionals, never `undefined`), `verbatimModuleSyntax` (`import type` for model types), `noPropertyAccessFromIndexSignature`, `noUncheckedIndexedAccess`, `skipLibCheck` | `tsconfig.base.json`                     |
| Layering                   | services take `Db` and collaborators in the constructor; errors are `AppError`; audit through `AuditLogger`                                                                                                                 | `apps/api/src/plans/plan-service.ts`     |
| Tests                      | Vitest; Postgres integration tests with `createTestDb`/`resetDb`; sandbox tests gated by `PAYPAL_SANDBOX_TESTS=1`                                                                                                           | `apps/api/test/approval-service.test.ts` |
| Commands                   | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` / `pnpm test:coverage`                                                                                                                                      | root `package.json`                      |
| Package manager            | pnpm 12.6; SDK installed as `paypal@github:context-plugins/paypal-typescript-sdk#5d0df8a…` and allow-listed in `pnpm-workspace.yaml`                                                                                        | —                                        |
| Baseline                   | typecheck clean with the SDK installed; 147 tests pass before any PayPal code                                                                                                                                               | run 2026-11-10                           |

## Host and credentials

- The SDK declares **one environment and no selector**. Its default base URL is
  `https://api-m.sandbox.paypal.com` (map: `sdk-map.md` Servers & auth).
- **YOUR CALL:** we always pass `serverOptions: { baseUrl: config.paypal.baseUrl }`.
  `config.paypal.baseUrl` comes from `PAYPAL_ENV`, which is `sandbox` or `live` (`apps/api/src/config.ts`).
- The factory refuses to build a client when `PAYPAL_CLIENT_ID` or `PAYPAL_CLIENT_SECRET` is missing,
  because an unset `oauth2` sends no credential and fails only later with a 401 (map).
- Startup fails if `PAYPAL_ENV=live` is set while `APP_BASE_URL` is a localhost URL, so a live
  credential is never used from a dev machine.
- The REST client uses the same `config.paypal.baseUrl`.
- **smoke:** the sandbox credential is valid for every in-scope read. No operation answered 403.

## Contract sheet: SDK operations

All of these share the call shape `op(request, options?)`, return `ApiPromise<T, E>`, use the `oauth2`
scheme and the `default` server group, and have no pagination (map: `sdk-map.md`). The `Error` model
is imported as `type Error as PayPalErrorBody`, so it never shadows the global `Error`. The error
family is `PaypalError`.

| Operation                              | Signature (request type)                      | Wire                                    | Returns                | Error arms (status)                                                                                                      | Label |
| -------------------------------------- | --------------------------------------------- | --------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----- |
| `vault.createSetupToken`               | `Vault.CreateSetupTokenRequest`               | `POST /v3/vault/setup-tokens`           | `SetupTokenResponse`   | `error` 400 · `error2` 403 · `error3` 422 · `error4` 500 · `undeclared`                                                  | map   |
| `vault.getSetupToken`                  | `Vault.GetSetupTokenRequest`                  | `GET /v3/vault/setup-tokens/{id}`       | `SetupTokenResponse`   | `error` 403 · `error2` 404 · `error3` 422 · `error4` 500 · `undeclared`                                                  | map   |
| `vault.createPaymentToken`             | `Vault.CreatePaymentTokenRequest`             | `POST /v3/vault/payment-tokens`         | `PaymentTokenResponse` | `error` 400 · `error2` 403 · `error3` 404 · `error4` 422 · `error5` 500 · `undeclared`                                   | map   |
| `vault.getPaymentToken`                | `Vault.GetPaymentTokenRequest`                | `GET /v3/vault/payment-tokens/{id}`     | `PaymentTokenResponse` | `error` 403 · `error2` 404 · `error3` 422 · `error4` 500 · `undeclared`                                                  | map   |
| `orders.createOrder`                   | `Orders.CreateOrderRequest`                   | `POST /v2/checkout/orders`              | `Order`                | `error` 400 · `error2` 401 · `error3` 422 · `error4` default · `undeclared`                                              | map   |
| `orders.getOrder`                      | `Orders.GetOrderRequest`                      | `GET /v2/checkout/orders/{id}`          | `Order`                | `error` 401 · `error2` 404 · `error3` default · `undeclared`                                                             | map   |
| `orders.captureOrder`                  | `Orders.CaptureOrderRequest`                  | `POST /v2/checkout/orders/{id}/capture` | `Order`                | `error` 400 · `error2` 401 · `error3` 403 · `error4` 404 · `error5` 422 · `error6` 500 · `error7` default · `undeclared` | map   |
| `transactionSearch.searchBalances`     | `TransactionSearch.SearchBalancesRequest`     | `GET /v1/reporting/balances`            | `BalancesResponse`     | `defaultError` 400 · `defaultError2` 403 · `defaultError3` 500 · `defaultError4` default · `undeclared`                  | map   |
| `transactionSearch.searchTransactions` | `TransactionSearch.SearchTransactionsRequest` | `GET /v1/reporting/transactions`        | `SearchResponse`       | `searchError` default · `undeclared`                                                                                     | map   |

No in-scope operation resolves to `undefined`. `deletePaymentToken` would, but it is out of scope
(map).

### Request fields we set

The request object is flat. The SDK fans each field out to its channel. A field with a default is sent
even when omitted.

| Operation                                  | Field                                                                  | Channel / wire                          | Required                                                                                 | Default                               | Value                                                                       | Label                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| createSetupToken                           | `payPalRequestId`                                                      | header `PayPal-Request-Id`              | no                                                                                       | —                                     | the claim's request id (kept 3 h by PayPal)                                 | map + api-reference                                              |
| createSetupToken                           | `body.paymentSource.paypal.usageType`                                  | body `payment_source.paypal.usage_type` | no                                                                                       | —                                     | `"MERCHANT"` (`PayPalPaymentTokenUsageType.Merchant`)                       | map (model file)                                                 |
| createSetupToken                           | `body.paymentSource.paypal.experienceContext.returnUrl` / `.cancelUrl` | body                                    | no                                                                                       | —                                     | `${APP_BASE_URL}/client/vault/return` and `…/cancel`                        | map (model file)                                                 |
| getSetupToken / getPaymentToken / getOrder | `id`                                                                   | path                                    | yes                                                                                      | —                                     | the stored PayPal id                                                        | map                                                              |
| createPaymentToken                         | `payPalRequestId`                                                      | header                                  | no                                                                                       | —                                     | the claim's request id                                                      | map                                                              |
| createPaymentToken                         | `body.paymentSource.token`                                             | body `payment_source.token`             | `id` and `type` required                                                                 | —                                     | `{ id: setupTokenId, type: "SETUP_TOKEN" }`                                 | map (model file)                                                 |
| createOrder                                | `payPalRequestId`                                                      | header                                  | no (but **mandatory** for single-step orders using `paypal.vault_id`, per api-reference) | —                                     | the claim's request id (kept 6 h)                                           | map + api-reference                                              |
| createOrder                                | `prefer`                                                               | header `Prefer`                         | no                                                                                       | `"return=minimal"`                    | `"return=representation"`, because we need the capture id from the response | map + api-reference                                              |
| createOrder                                | `body.intent`                                                          | body                                    | yes                                                                                      | —                                     | `"CAPTURE"`                                                                 | map (model file)                                                 |
| createOrder                                | `body.purchaseUnits[0].amount`                                         | body                                    | yes: `currencyCode`, `value`                                                             | —                                     | `{ currencyCode: "USD", value: "1729.00" }`                                 | map (model file)                                                 |
| createOrder                                | `body.purchaseUnits[0].invoiceId`                                      | body                                    | no                                                                                       | —                                     | the PayPal invoice number, for reconciliation                               | YOUR CALL (an UNKNOWN OUTCOMES row needs a searchable reference) |
| createOrder                                | `body.purchaseUnits[0].customId`                                       | body                                    | no                                                                                       | —                                     | the Terms deal id                                                           | YOUR CALL (same reason)                                          |
| createOrder                                | `body.paymentSource.paypal.vaultId`                                    | body                                    | no                                                                                       | —                                     | the client's ACTIVE payment token id                                        | map (model file)                                                 |
| captureOrder                               | `id`, `payPalRequestId`, `prefer`                                      | path, header, header                    | yes, no, no                                                                              | `prefer` defaults to `return=minimal` | order id; claim request id; `return=representation`                         | map                                                              |
| searchBalances                             | `currencyCode`                                                         | query `currency_code`                   | no                                                                                       | —                                     | `"USD"`                                                                     | map                                                              |
| searchTransactions                         | `startDate`, `endDate`                                                 | query                                   | yes                                                                                      | —                                     | ISO date-times, at most 31 days apart (**UNVERIFIED**: settled by spike S4) | map                                                              |
| searchTransactions                         | `page`                                                                 | query                                   | no                                                                                       | `1`                                   | driven by our loop, capped at 20 pages                                      | map                                                              |

### Defaults the SDK sends on its own

Observed in `apps/api/test/paypal/vault-payment.test.ts`, which asserts the full body. These come from
`s.defaulted(...)` entries in the SDK's model schemas. Spike S5 succeeded with them in place.

| Operation                 | Field                                                          | Value sent                            |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------- |
| createSetupToken          | `payment_source.paypal.permit_multiple_payment_tokens`         | `false`                               |
| createSetupToken          | `payment_source.paypal.experience_context.shipping_preference` | `GET_FROM_FILE`                       |
| createSetupToken          | `payment_source.paypal.experience_context.user_action`         | `CONTINUE`                            |
| createOrder, captureOrder | `Prefer` header                                                | overridden to `return=representation` |

### Optional fields we leave out

| Operation          | Field                                                                                                                                                                                                                | What requires it                                                                      | Set it? |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- |
| createSetupToken   | `body.customer`                                                                                                                                                                                                      | nothing (PayPal mints a customer id, which we store from the response)                | ❌      |
| createSetupToken   | `paypal.description`, `usagePattern`, `shipping`, `permitMultiplePaymentTokens`, `customerType`, `billingPlan`, `experienceContext.brandName/locale/shippingPreference/vaultInstruction/appSwitchContext/userAction` | nothing                                                                               | ❌      |
| createPaymentToken | `body.customer`                                                                                                                                                                                                      | nothing                                                                               | ❌      |
| createOrder        | `payPalMockResponse`, `payPalPartnerAttributionId`, `payPalClientMetadataId`, `payPalAuthAssertion`                                                                                                                  | nothing                                                                               | ❌      |
| createOrder        | `body.processingInstruction`, `payer`, `applicationContext`, `purchaseUnits[0].referenceId/payee/paymentInstruction/description/softDescriptor/items/shipping/supplementaryData`                                     | nothing. `payee` stays unset, so the payee is the app owner (Maya); see invariant I-2 | ❌      |
| captureOrder       | `payPalMockResponse`, `payPalClientMetadataId`, `payPalAuthAssertion`, `body`                                                                                                                                        | nothing                                                                               | ❌      |
| getOrder           | `fields`, `payPalMockResponse`, `payPalAuthAssertion`                                                                                                                                                                | nothing                                                                               | ❌      |
| searchBalances     | `asOfTime`                                                                                                                                                                                                           | nothing                                                                               | ❌      |
| searchTransactions | every filter, plus `fields` (default `transaction_info`), `balanceAffectingRecordsOnly` (default `Y`) and `pageSize` (default `100`)                                                                                 | nothing; the defaults apply                                                           | ❌      |

### Response members we depend on

Every response member is optional in the models. A truncated body therefore decodes cleanly, so we
assert on each member below right after the call (map: `sdk-map.md` Models; typescript-error-handling).

| Operation                  | Members asserted                                                                                            | If absent                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| createSetupToken           | `id`, `links[rel="approve"].href`                                                                           | outcome unknown, so re-read (UNKNOWN OUTCOMES)                  |
| getSetupToken              | `status` (`PaymentTokenStatus`: `CREATED`, `PAYER_ACTION_REQUIRED`, `APPROVED`, `VAULTED`, `TOKENIZED`)     | PayPal response unreadable, reported as an error                |
| createPaymentToken         | `id`, `customer.id`                                                                                         | outcome unknown, so re-read                                     |
| createOrder / captureOrder | `id`, `status` (`OrderStatus`), `purchaseUnits[0].payments.captures[0].{id,status,amount}` once `COMPLETED` | outcome unknown, so re-read with `getOrder`                     |
| searchBalances             | `balances[currency="USD"].availableBalance.value`                                                           | balance falls back to the Terms ledger (CONTEXT.md S4 fallback) |

### Smoke results (2026-11-10, read-only)

| Call                                             | Result                                                                                                                  | Consequence                                                                                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchBalances({currencyCode:"USD"})`           | 200, available 5000.00, while the dashboard shows 5200                                                                  | Reporting lags. Record `as_of_time` and show it; S4 measures the lag                                                                                                                                      |
| `searchTransactions` (3 days)                    | 200, 0 items                                                                                                            | —                                                                                                                                                                                                         |
| `getOrder` (unknown id)                          | 404, arm `error2`                                                                                                       | as mapped                                                                                                                                                                                                 |
| `getSetupToken` / `getPaymentToken` (unknown id) | **`DecodeError` on status 404**: PayPal's error body has `links` without `rel`, which the SDK's `Error` schema requires | A Vault 404 is detected by `err.kind === "decode" && err.status === 404`, never by arm. Treated as "not found" for these two reads only, because the status survived. Reported upstream in docs/paypal.md |
| `listCustomerPaymentTokens` (unknown customer)   | 404, arm `undeclared`                                                                                                   | not used                                                                                                                                                                                                  |

## Durable writes

Every PayPal write follows the order **claim → call → record**. A claim is a row in a new table,
`PayPalWrite`, committed before the call:

| Column                             | Notes                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `key`                              | `@unique`; computed the same way by every caller attempting the same operation |
| `operation`                        | —                                                                              |
| `requestId`                        | `@unique`; minted once when the claim is made                                  |
| `status`                           | `CLAIMED`, `SUCCEEDED`, `FAILED` or `UNKNOWN`                                  |
| `resultRef`, `errorJson`, `dealId` | —                                                                              |
| `createdAt`, `settledAt`           | —                                                                              |

The `requestId` is sent as `PayPal-Request-Id`, the key PayPal deduplicates on across calls. This is
separate from the SDK's own per-call `Idempotency-Key`. A second caller with the same `key` hits the
unique constraint (Prisma `P2002`). That error is caught by its code, and the caller then uses the
winner's row. A claim is released, by deleting the row, when PayPal refuses the call with a 4xx. This
lets a corrected attempt go through later.

### Duplicate claims

| Write                                                     | Claim key                                                                                                    | What rejects the second one | Where caught               | Where in the code                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| createSetupToken                                          | `vault-setup:{vaultTokenRowId}` (one VaultToken row per client while PENDING, enforced in a Serializable tx) | `PayPalWrite.key` unique    | `WriteLedger.claim`, P2002 | `apps/api/src/paypal/write-ledger.ts` `claim`; `apps/api/src/paypal/vault-service.ts` `startSetup` |
| createPaymentToken                                        | `vault-token:{setupTokenId}`                                                                                 | same                        | same                       | `vault-service.ts` `completeSetup`                                                                 |
| createOrder (agent payment)                               | `order:{dealId}`                                                                                             | same                        | same                       | `apps/api/src/paypal/payment-service.ts` `payWithVault`                                            |
| captureOrder (only if the order is not already COMPLETED) | `capture:{orderId}`                                                                                          | same                        | same                       | `payment-service.ts` `captureIfNeeded`                                                             |
| Invoice full update (REST)                                | `invoice-update:{dealId}:{dealVersion}`                                                                      | same                        | same                       | `apps/api/src/paypal/invoice-service.ts` `applyTerms`                                              |
| Invoice reminder (REST)                                   | `invoice-remind:{dealId}`                                                                                    | same                        | same                       | `invoice-service.ts` `remind`                                                                      |
| Record invoice payment (REST)                             | `invoice-payment:{captureId}`                                                                                | same                        | same                       | `invoice-service.ts` `recordPayment`                                                               |
| Create and send invoice (REST, seed)                      | `invoice-create:{seedKey}`, `invoice-send:{paypalInvoiceId}`                                                 | same                        | same                       | `scripts/seed-sandbox.ts` via `invoice-service.ts`                                                 |
| Register webhook (REST)                                   | `webhook:{url}`                                                                                              | same                        | same                       | `apps/api/src/paypal/webhook-service.ts` `ensureRegistered`                                        |
| Payout (REST, seed)                                       | `payout:{seedKey}` (`sender_batch_id` = request id)                                                          | same                        | same                       | `scripts/seed-sandbox.ts`                                                                          |

### Unknown outcomes

A connection failure or timeout on a write is **unknown**, never failed. So is a 5xx and an unreadable 2xx body
(**YOUR CALL**: a 5xx can follow a partial commit at PayPal; `mayHaveTakenEffect` in `apps/api/src/paypal/errors.ts`). A request that never left
(`AuthError`, `EncodeError`, or our own REST client failing before it sent anything) is **failed** and
gets no re-read.

| Write              | Re-read with                                                                                                                                     | Reference searched                 | Where in the code                    | Test that fails the connection                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| createSetupToken   | replay `createSetupToken` with the same `PayPal-Request-Id` (PayPal returns the stored response within 3 h; **UNVERIFIED**, settled by spike S5) | claim `requestId`                  | `vault-service.ts` `settleUnknown`   | `apps/api/test/paypal/vault-service.test.ts` "settles a dropped setup-token call by replay" |
| createPaymentToken | replay with the same `PayPal-Request-Id`                                                                                                         | claim `requestId`                  | `vault-service.ts` `settleUnknown`   | same file, "settles a dropped payment-token call"                                           |
| createOrder        | replay with the same `PayPal-Request-Id` (kept 6 h); found → `getOrder`                                                                          | claim `requestId`, then order `id` | `payment-service.ts` `settleUnknown` | `apps/api/test/paypal/payment-service.test.ts` "settles a dropped order by replay"          |
| captureOrder       | `getOrder(orderId)` → `purchaseUnits[0].payments.captures`                                                                                       | order id                           | `payment-service.ts` `settleUnknown` | same file, "settles a dropped capture by reading the order"                                 |
| Invoice update     | `GET /v2/invoicing/invoices/{id}` and compare the discount and partial-payment terms                                                             | invoice id + expected terms        | `invoice-service.ts` `settleUnknown` | `apps/api/test/paypal/invoice-service.test.ts`                                              |
| Reminder           | not observable on the invoice. The claim stays `UNKNOWN` and is never re-sent automatically; the owner sees "may have been sent"                 | —                                  | `invoice-service.ts`                 | same file                                                                                   |
| Record payment     | `GET` invoice → `payments.transactions[].payment_id == captureId`                                                                                | capture id                         | `invoice-service.ts` `settleUnknown` | same file                                                                                   |
| Register webhook   | `GET /v1/notifications/webhooks` → match by url                                                                                                  | url                                | `webhook-service.ts`                 | `apps/api/test/paypal/webhook-service.test.ts`                                              |

Each test also has a "never sent" twin. For example, an `AuthError` asserts that no re-read request
was made.

## Cross-operation invariants

| Invariant                                                                                                                                                           | Where the legal set comes from    | Enforced where                                                        | Test                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| I-1: `vaultId` on an order is a `VaultToken` row with status `ACTIVE` belonging to the paying client                                                                | our `VaultToken` table            | `payment-service.ts` `payWithVault`, before the claim                 | `payment-service.test.ts` "refuses a token of another client; no PayPal call" |
| I-2: the payee is always the app owner (Maya); no `payee` field is ever set from input                                                                              | the app owner's `PayPalAccount`   | `payment-service.ts` (field never built)                              | request-shape test: the body has no `payee`                                   |
| I-3: an invoice we update, remind or record against belongs to the deal's supplier and is the deal's invoice                                                        | our `Invoice` and `Deal` rows     | `invoice-service.ts`, before the claim                                | `invoice-service.test.ts`                                                     |
| I-4: the amount charged equals the deal's agreed payment (amountEarly − discount); above the client's auto-pay limit it needs an APPROVED `CLIENT_PAYMENT` approval | `Deal` terms and `ClientPolicy`   | `payment-service.ts`, before the claim, through `evaluateClientOffer` | `payment-service.test.ts`                                                     |
| I-5: a deal reaches PAID/PARTIALLY_PAID only from a verified webhook or a server read of the invoice                                                                | `DealStore` actor rule (`PAYPAL`) | `deal-store.ts` (exists) and the webhook processor                    | `deal-store.test.ts` (exists)                                                 |

## When PayPal says no

This mapping is the same for every operation, SDK or REST, and lives in
`apps/api/src/paypal/errors.ts` `toAppError`.

| PayPal status                           | We answer                                                                      | The caller reads                                                                               | Test                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 400 / 422                               | `VALIDATION_FAILED` (400)                                                      | PayPal's reason: `details[].description` joined, else `message`; plus `paypal.{name, debugId}` | fake a 422 with a reason; assert the reason is in our body |
| 404                                     | `NOT_FOUND`                                                                    | "PayPal has no such {object}"                                                                  | fake a 404                                                 |
| 409                                     | `CONFLICT`                                                                     | PayPal's reason                                                                                | —                                                          |
| 401 / 403                               | `PAYPAL_ERROR` (502)                                                           | a fixed message: "Terms could not authenticate with PayPal"                                    | fake a 401; assert 502 and the fixed message               |
| 429                                     | `RATE_LIMITED` (429) on our side, `retryable: true`                            | a fixed message: our PayPal quota                                                              | —                                                          |
| 5xx                                     | `PAYPAL_ERROR` (502), `retryable: true`                                        | a fixed message                                                                                | —                                                          |
| `DecodeError` on a 2xx                  | `PAYPAL_ERROR` (502), outcome unknown for writes                               | a fixed message                                                                                | fake a type-mismatched 200                                 |
| `DecodeError` on 404 (Vault reads only) | `NOT_FOUND`                                                                    | as 404                                                                                         | fake the observed Vault 404 body                           |
| no response, write                      | per UNKNOWN OUTCOMES                                                           | "Outcome unknown; Terms is checking with PayPal"                                               | —                                                          |
| no response, read                       | `PAYPAL_ERROR` (502), `retryable: true`                                        | a fixed message                                                                                | —                                                          |
| `AuthError`                             | `NOT_CONFIGURED` (503) when credentials are missing, else `PAYPAL_ERROR` (502) | a fixed message; `cause` is logged                                                             | fake a 401 from the token endpoint                         |

**YOUR CALL:** a PayPal 422 becomes our 400 `VALIDATION_FAILED` rather than a pass-through 422,
because our 422 is reserved for `POLICY_BLOCKED`. The PayPal reason is always in the body.

## Retries, timeouts, logging

- **Retry policy (YOUR CALL):** `retry: { timeout: 15_000 }`. The other defaults stand: GET/HEAD/PUT/
  OPTIONS are retried on 408/429/5xx, faults and timeouts, up to 3 times. POST is never retried by the
  SDK; it stays out of `httpMethodsToRetry`. The only operation we send with PUT is the REST invoice
  full update. Our REST client does not retry PUT, because a re-sent update is settled by the
  UNKNOWN OUTCOMES re-read instead.
- **Whole-call deadline:** every SDK call goes through `PayPalGateway.bounded`, with an
  `AbortSignal.timeout(30_000)` per logical call.
- **Logging:** `logging: { level: "off" }` is set explicitly, so `PAYPAL_CLIENT_LOG` cannot switch it
  on, and `logRequestBody` is never set. Our own pino logs record `method`, `uri`, `status` and the
  `paypal-debug-id` response header, never bodies. The REST client logs the same fields.
- **Pagination and streaming:** none in the SDK. Transaction Search pages are driven by our loop: a
  20-page cap, a 30 s deadline, and a no-progress guard.

## Webhooks

The SDK has no webhook surface. Each inbound event is handled in this order:

1. Capture the raw body.
2. Call `POST /v1/notifications/verify-webhook-signature` with the five `paypal-*` headers, our
   `PAYPAL_WEBHOOK_ID` and the event, sent as `webhook_event`.
3. Store the event as `WebhookEvent`, unique on `paypalEventId`.
4. Process it only if verification returned `SUCCESS`.

Duplicates are dropped on that unique key; PayPal re-deliveries reuse the event id (S3). Settlement signals (S3): `PAYMENT.CAPTURE.COMPLETED` for agent payments, matched by the capture's `custom_id` (deal id), and `INVOICING.INVOICE.PAID` for invoice payments, whose `resource.invoice.status` distinguishes PAID from PARTIALLY_PAID (there is no PARTIALLY_PAID event type).

## Spikes

The spikes are scripts under `scripts/spikes/`. They run against the sandbox, write raw output to
`scripts/spikes/out/` (gitignored), and record their results in `docs/paypal.md`.

| Spike | Question                                                                                                                                              | Uses                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| S1    | Can a SENT invoice be fully updated with a discount and an allowed partial payment, and what does the client see?                                     | REST Invoicing                                                       |
| S2    | Does a vault-funded order to Maya, plus record-payment, turn the invoice PAID or PARTIALLY_PAID? Is `vault_id` single-step, i.e. COMPLETED at create? | SDK Orders + REST Invoicing                                          |
| S3    | Which webhook events fire for invoice payment and capture, and does verification pass?                                                                | REST Webhooks + tunnel                                               |
| S4    | How far does reporting lag behind?                                                                                                                    | SDK TransactionSearch                                                |
| S5    | Does PayPal-wallet vault setup work in sandbox for a client account?                                                                                  | SDK Vault (needs the client's person to approve once in the browser) |

## Assumptions and blockers

- **Needs the user for S2/S5:** one approval click as Harbor & Co in the sandbox, on the vault setup
  approval link. Claude never signs in or enters passwords.
- **Assumption (minor):** PayPal returns the stored response when a create is replayed with the same
  `PayPal-Request-Id` (api-reference says the keys are stored for 3 h and 6 h). Verified in S2/S5.
  If replay is not honoured, an unknown outcome stays `UNKNOWN` for owner review.
- **Upstream drift:** Vault error bodies fail the SDK's `Error` schema (`links[].rel`). This is worked
  around by status, as described above, and noted in docs/paypal.md.

## Required reading

- MUST load `typescript-error-handling`: one family on `err.kind`; arms per operation; Vault 404 decode
  drift. Loaded.
- MUST load `typescript-client-initialization`: factory with a credential check, one long-lived
  client, explicit base URL. Loaded.
- MUST load `typescript-testing`: fake `fetch` seam, token request first, wire-shaped bodies,
  `maxRetries: 0`. Loaded.
- MUST load `typescript-configuration-resilience`: retry gate, per-attempt timeout plus a whole-call
  signal, logging pinned off. Loaded.
- MUST load `typescript-calling-endpoints` before the first operation call, for `.asApiResult()` on
  the returned value and the flat request object.
- MUST load `typescript-models` before building request bodies, for `exactOptionalPropertyTypes`,
  open enums and wire names.
