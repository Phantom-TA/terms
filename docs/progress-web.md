# Web progress

**PASS**: actually tested, with evidence. **PARTIAL**: works with stated limits. **FAIL**: broken. Nothing is marked PASS without running it.

Evidence commands, from `apps/web`: `pnpm gate` (typecheck, lint, format, Vitest with jest-axe) and `pnpm e2e` (Playwright at 1366×768 and 820×1180; axe in the browser, including colour contrast).

## Phase 1: design system and shell

Last run 2026-11-09: 121 component tests passed; Playwright 24 tests passed, and 144 of 144 runs across two `--repeat-each=3` rounds.

| Feature                                                                                  | Status  | Evidence                                                                                              | Limits                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Design tokens, type, Tailwind theme                                                      | PASS    | `e2e/style-guide.spec.ts` axe with colour contrast at both widths; no horizontal overflow             | Light theme only (W-002)                                                                                   |
| Button, Field, Chip, EditableChip, Badge, Card                                           | PASS    | `src/ui/*.test.tsx`                                                                                   |                                                                                                            |
| Finance components (deal pill, policy badge, money, best-effort and do-not-contact tags) | PASS    | `src/ui/finance.test.tsx`; `src/lib/display.test.ts` ties the accent to committed states              |                                                                                                            |
| Toast, Dialog                                                                            | PASS    | `src/ui/Toast.test.tsx`, `src/ui/Dialog.test.tsx`; dialog focus return also in Playwright             |                                                                                                            |
| Loading, empty, error (debug ID), pending states                                         | PASS    | `src/ui/states.test.tsx`                                                                              |                                                                                                            |
| Typed API client                                                                         | PASS    | `src/api/client.test.ts`                                                                              | Not yet run against A's server                                                                             |
| SSE client and provider                                                                  | PASS    | `src/api/stream.test.ts`, `src/api/StreamProvider.test.tsx`                                           | Not yet run against A's server                                                                             |
| AG Grid theme and cell renderers                                                         | PASS    | `src/grid/renderers.test.tsx`; real grid in `e2e/style-guide.spec.ts`, with no AG validation warnings | Watermark until `VITE_AG_GRID_LICENSE_KEY` is set                                                          |
| App shell, navigation, sandbox and demo label                                            | PARTIAL | `src/app/shell.test.tsx`, `e2e/shell.spec.ts`                                                         | Mock mode only: session endpoints are not on `develop` yet. Navigation is empty until Phase 2 adds screens |
| Owner and client session switcher, session picker                                        | PARTIAL | `src/app/shell.test.tsx`, `e2e/shell.spec.ts`                                                         | Mock mode only, same reason                                                                                |
| Mocks excluded from production                                                           | PASS    | `pnpm build` runs `scripts/check-prod-bundle.mjs`                                                     |                                                                                                            |
| Style guide route (dev only)                                                             | PASS    | `e2e/style-guide.spec.ts`; bundle check confirms it is absent from production                         |                                                                                                            |

## Spikes

| Spike                      | Status      | Notes   |
| -------------------------- | ----------- | ------- |
| S6: AG Studio custom agent | Not yet run | Phase 5 |
