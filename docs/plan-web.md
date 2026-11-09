# Web plan (Developer B)

Scope: `apps/web/` and the product docs. Source of truth: `CONTEXT.md`. Contracts: `@terms/shared` at `contracts-v1`.

Status of each item lives in `docs/progress-web.md`. Decisions live in `docs/decisions-web.md`.

## Stack

| Concern         | Choice                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| App             | React 19, Vite 8, TypeScript 6 (strict, same flags as `tsconfig.base.json`)    |
| Styling         | Tailwind CSS 4 with CSS-variable design tokens                                 |
| Routing         | React Router 7 (library mode), screens lazy-loaded                             |
| Server state    | TanStack Query 5, patched from SSE events                                      |
| Grid and charts | AG Grid Enterprise 36, AG Charts Enterprise 14, AG Studio 3                    |
| Tests           | Vitest + React Testing Library + jest-axe; Playwright + @axe-core/playwright   |
| Mocks           | MSW, dev-only (`VITE_USE_MOCKS=true`) and tests; never in the production build |

## Architecture rules

- `src/api/client.ts` is the only HTTP client. It is generic over the shared `endpoints` table, so paths, bodies, queries and responses are all typed from `@terms/shared` and every response is validated with its shared schema.
- `src/api/stream.ts` is the only SSE client. Every frame is validated against `ServerEvent`.
- Errors are an `ApiError` carrying the server's code, message, retryability, policy checks and PayPal debug ID. `ErrorState` renders all of them.
- Money is displayed with the shared `formatMoney` from server strings. The browser never computes a payment outcome. Shared policy helpers are used only to pre-validate owner edits.
- The nav is built from a screen registry. A screen appears only once it exists, so there are no dead links.
- The accent colour means one thing: cash committed. Primary buttons are ink, not accent.

## Directory layout

```text
apps/web/
  src/
    api/          client, errors, stream, query keys
    app/          providers, router, screen registry, session context
    grid/         AG Grid setup, theme, cell renderers
    charts/       AG Charts setup and theme
    mocks/        MSW handlers and schema-validated fixtures (dev and tests only)
    screens/      one folder per screen
    styles/       tokens and global CSS
    ui/           design-system components
    lib/          display formatting helpers
  e2e/            Playwright tests
  scripts/        bundle checks
```

## Test gate (every feature, before commit)

1. `pnpm --filter @terms/web typecheck`
2. `pnpm --filter @terms/web lint` and `format:check`
3. Vitest + RTL covering loading, empty, error, pending and success, plus key interactions
4. axe on each screen (jest-axe in component tests; `@axe-core/playwright` in the browser, which also checks colour contrast)
5. Playwright for the main flow: dev-mock mode first, then the real API on `develop` when A's endpoints exist

## Phases

### Phase 1: design system and shell

Design tokens, Tailwind theme, fonts. Base components: button, input/field, chip, badge, card, table cell renderers, toast, dialog, skeleton, empty state, error state with debug ID. API client, SSE client, session provider. App shell, navigation, owner and client session switcher, sandbox/demo label. AG Grid custom theme. Everything shown on a dev-only `/style-guide` route.

### Phase 2: Workbench

Goal bar and chips (`createGoal`, `updateGoal`, `createPlan`). AG Grid: one row per invoice with every CONTEXT.md column, renderers (deal-state pill, action selector, policy badges, money with discount struck through), editable plan cells validated with shared helpers and sent through `updatePlanItem`, master-detail (reasoning and transcript), row grouping by action, pinned summary row, live updates from SSE. Top rail with gap, committed, cost, ceiling and **Approve plan**. AG Charts runway with a labelled payroll line, before and after, committed and best-effort separate.

### Phase 3: Negotiation Room

Supplier and client agents side by side in their own colours. Terms, annualised rate and policy badges on each message. NEEDS_OWNER cards with Approve and Reject. PayPal API chips from audit data only. Live over SSE.

### Phase 4: remaining screens

Approvals inbox, Client Payables Desk (ranked offers, policy, vault setup redirect flow), public Offer page (Pay now, Pay part now, Not now, free-text reply, valid/expired/used token states), Audit trail, Connect & import, Settings.

### Phase 5: Cash Studio

Spike S6 first: AG Studio custom "cash strategist" agent through `POST /api/studio/turn`, restricted tools. Build on pass; on fail ship AG Grid and AG Charts only and document why. Custom cost-versus-cash curve widget.

### Phase 6: polish and integration

State-change animation, keyboard navigation, focus states, `--scale` seed performance, three clean end-to-end runs with A on `develop`.

### Phase 7: docs

`README.md` product sections with real screenshots, `docs/user-guide.md`, `docs/judging-map.md`, `docs/devpost.md`. Technical facts come from A's docs.

## Git

`b/web` from `develop`, rebased regularly and on each new `contracts-vN`. Pull request into `develop` at the end of each phase. Small Conventional Commits with a body. No AI attribution.
