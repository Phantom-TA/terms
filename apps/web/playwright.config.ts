import { defineConfig } from '@playwright/test';

const PORT = 5199;

/**
 * Mock mode runs against the dev server with VITE_USE_MOCKS=true. Point PLAYWRIGHT_BASE_URL at a
 * running app to test against the real sandbox-backed API instead.
 */
const externalBaseUrl = process.env['PLAYWRIGHT_BASE_URL'];

export default defineConfig({
  testDir: './e2e',
  // The real-server suite has its own config (playwright.real.config.ts).
  testIgnore: 'real/**',
  fullyParallel: true,
  workers: 3,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseUrl ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'laptop', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
  ],
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: `VITE_USE_MOCKS=true node node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: false,
          stdout: 'ignore' as const,
        },
      }),
});
