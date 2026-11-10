import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Root Vitest config: runs every workspace project that defines its own config.
// apps/web is excluded because Developer B owns its test setup.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/api/vitest.config.ts'].filter((p) =>
      p.includes('*') ? true : existsSync(p),
    ),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'apps/api/src/generated/**'],
      thresholds: {
        // CONTEXT.md / core prompt: ≥ 90% lines for shared, planner, policy layer and deal engine.
        'packages/shared/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'apps/api/src/planner/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'apps/api/src/deals/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'apps/api/src/plans/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'apps/api/src/approvals/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'apps/api/src/negotiation/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'apps/api/src/paypal/**': { lines: 90, functions: 85, branches: 85, statements: 90 },
        'apps/api/src/ai/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
