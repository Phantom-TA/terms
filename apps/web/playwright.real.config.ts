import { defineConfig } from '@playwright/test';

/**
 * The demo against the real server and the PayPal sandbox (see e2e/real/README.md). It needs a
 * running server serving the built app, and a freshly seeded sandbox: it does not start anything.
 * The tests share one server's state, so they run one at a time, in order.
 */
const baseURL = process.env['PLAYWRIGHT_BASE_URL'];
if (!baseURL) {
  throw new Error(
    'Set PLAYWRIGHT_BASE_URL to the running Terms server, e.g. http://localhost:3000',
  );
}

export default defineConfig({
  testDir: './e2e/real',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  // The server negotiates in the background, and models and PayPal take their time.
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-real' }]],
  outputDir: 'test-results-real',
  use: {
    baseURL,
    trace: 'on',
    screenshot: 'on',
    viewport: { width: 1366, height: 768 },
  },
});
