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
    },
  },
});
