import { expect, test } from '@playwright/test';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";
const EXTRA = 300;

// The demo's scale shot is 30 invoices across 12 clients; this is ten times that.
test('the Workbench stays quick with 300 more invoices', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((n) => {
    sessionStorage.setItem('terms.mock.scale', String(n));
  }, EXTRA);
  await page.getByRole('button', { name: /Maya Studio/ }).click();
  await page.getByLabel(/What cash do you need/).fill(SENTENCE);
  await page.getByRole('button', { name: 'Read my goal' }).click();

  const started = Date.now();
  await page.getByRole('button', { name: 'Confirm and build plan' }).click();
  const grid = page.getByTestId('workbench-grid');
  await expect(grid.locator('[row-id="inv_harbor"]').first()).toBeVisible();
  // The extra rows are in the grid, and only those in view are drawn (row virtualisation).
  await expect(grid.locator('[row-id^="inv_scale_"]').first()).toBeAttached();
  expect(await grid.locator('[row-id^="inv_scale_"]').count()).toBeLessThan(100);
  const toFirstRows = Date.now() - started;

  // Scrolling to the end of the grid shows the last rows promptly.
  const scrollStart = Date.now();
  await grid.locator('.ag-grid-viewport').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  // The last group is "Do not contact", below all 300 extra rows.
  await expect(grid.getByText('Birch Legal').first()).toBeVisible();
  const toScroll = Date.now() - scrollStart;

  test.info().annotations.push({
    type: 'timing',
    description: `${String(EXTRA)} extra invoices: first rows ${String(toFirstRows)} ms, scroll ${String(toScroll)} ms`,
  });
  expect(toFirstRows).toBeLessThan(3000);
  expect(toScroll).toBeLessThan(1500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
