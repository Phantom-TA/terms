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
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: {
        // CONTEXT.md / core prompt: ≥ 90% lines for shared, planner, policy layer and deal engine.
        'packages/shared/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
