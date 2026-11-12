# apps/web

The Terms web app: React, Vite, Tailwind CSS, AG Grid Enterprise, AG Charts and AG Studio. Owned by Developer B.

Contracts come from `@terms/shared` (see `docs/api.md`). Contract changes are requested in `docs/contract-requests.md`.

## Run it

From the repo root, after `pnpm install`:

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `pnpm --filter @terms/web dev`      | Dev server on port 5173, proxying `/api` to `http://localhost:3000`    |
| `pnpm --filter @terms/web dev:mock` | Dev server with mocks generated from the shared schemas; no API needed |
| `pnpm --filter @terms/web gate`     | Typecheck, lint, format check and component tests                      |
| `pnpm --filter @terms/web e2e`      | Playwright against the mock dev server, at laptop and tablet widths    |
| `pnpm --filter @terms/web build`    | Production build, then a check that no mock code reached it            |

Set `TERMS_API_ORIGIN` to proxy to a different API. Set `PLAYWRIGHT_BASE_URL` to run Playwright against a running app and real API.

The internal design-system page is at `/style-guide` in the dev server.

`VITE_AG_GRID_LICENSE_KEY` goes in the `.env` at the repo root. Without it the grid still works and shows a watermark.
