import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: { conditions: ['@terms/source'] },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one Postgres database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
