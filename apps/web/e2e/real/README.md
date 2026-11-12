# Running the demo against the real server

The tests in this folder run the demo against A's server and the PayPal sandbox. Mock mode
(`pnpm e2e`) never runs them. They start nothing themselves: they need a running server and a fresh
seed. They run in order on one server, so run them once per seed.

## Before the run (A, on the machine with the sandbox credentials)

1. Postgres is up and migrated: `pnpm db:up` (or `pnpm db:local`), then `pnpm db:deploy`.
2. Build the web app: `pnpm --filter @terms/web build`. The server serves `apps/web/dist`.
3. Seed a fresh demo run: `pnpm seed --reset --suffix <new letter>`.
4. Start the server: `pnpm --filter @terms/api dev` (it listens on port 3000).
5. Optional:
   - An AI key (`LLM_API_KEY`) to try Cash Studio and the model negotiators. Without one, the
     server uses its deterministic strategies and Cash Studio says it isn't configured.
   - A public URL for PayPal's webhooks (a tunnel, or the Render deploy). Without one, a payment is
     made but never confirmed, so the deal stays "waiting for PayPal confirmation".

## The run

From `apps/web`:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm e2e:real
```

To pay Juniper's invoice yourself and check the verified webhook marks it paid, add
`REAL_WAIT_FOR_PAYMENT=1`. The run then waits up to 10 minutes. The invoice link is printed under
"pay here" in the report.

## What it checks, in order

| #   | Test                                                                                                                                                            | Needs            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | The server is up and the six demo businesses are seeded, with no goal yet                                                                                       | Fresh seed       |
| 2   | The goal reads as the demo's ($6,200, max 1.2%, target $6,510, Pinecrest and Birch protected), and the plan has Juniper, Harbor and Oak Street with $54 planned |                  |
| 3   | Approving starts the negotiation; Harbor's counter comes back to the owner, $1 over the ceiling; approving it puts the terms on the PayPal invoice              | Within 3 minutes |
| 4   | Juniper's person approves the $4,960 payment; PayPal's invoice opens in a new tab; the desk waits for PayPal                                                    |                  |
| 5   | The audit trail shows the PayPal calls                                                                                                                          |                  |
| 6   | Cash Studio answers, or says it isn't configured                                                                                                                |                  |

The demo's figures are checked softly: a different figure is reported and the run carries on. The
report (`playwright-report-real/`) has a trace and screenshots for every test, which can serve as the
README's sandbox screenshots.

## Three clean runs

The plan asks for three clean runs on `develop`. For each one: reseed with a new suffix, restart the
server, run the suite and keep the report. Note any soft failures in `docs/progress-web.md`.
