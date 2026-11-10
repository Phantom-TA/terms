import { expect, type Page, test } from '@playwright/test';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";
const EXTRA = 300;

/** Milliseconds from building the plan to the Workbench's first rows, with `extra` more invoices. */
async function timeToFirstRows(page: Page, extra: number): Promise<number> {
  await page.goto('/');
  await page.evaluate((n) => {
    sessionStorage.clear();
    sessionStorage.setItem('terms.mock.scale', String(n));
  }, extra);
  await page.goto('/');
  await page.getByRole('button', { name: /Maya Studio/ }).click();
  await page.getByLabel(/What cash do you need/).fill(SENTENCE);
  await page.getByRole('button', { name: 'Read my goal' }).click();
  const started = Date.now();
  await page.getByRole('button', { name: 'Confirm and build plan' }).click();
  await expect(
    page.getByTestId('workbench-grid').locator('[row-id="inv_harbor"]').first(),
  ).toBeVisible();
  return Date.now() - started;
}

// The demo's scale shot is 30 invoices across 12 clients; this is ten times that. Times are compared
// with the same Workbench without the extra invoices, measured on the same machine at the same moment,
// so the test measures what the extra rows cost, not how busy the machine is.
test('the Workbench stays quick with 300 more invoices', async ({ page }) => {
  // A first run loads the Workbench's code and AG Grid, so both measured runs start warm.
  await timeToFirstRows(page, 0);
  const baseline = await timeToFirstRows(page, 0);
  const scaled = await timeToFirstRows(page, EXTRA);
  const grid = page.getByTestId('workbench-grid');

  // The extra rows are in the grid, and only those in view are drawn (row virtualisation).
  await expect(grid.locator('[row-id^="inv_scale_"]').first()).toBeAttached();
  expect(await grid.locator('[row-id^="inv_scale_"]').count()).toBeLessThan(100);

  // Scrolling to the end of the grid shows the last group promptly.
  const scrollStart = Date.now();
  await grid.locator('.ag-grid-viewport').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  // The last group is "Do not contact", below all 300 extra rows.
  await expect(grid.getByText('Birch Legal').first()).toBeVisible();
  const toScroll = Date.now() - scrollStart;

  test.info().annotations.push({
    type: 'timing',
    description: `first rows ${String(baseline)} ms without and ${String(scaled)} ms with ${String(EXTRA)} extra invoices; scroll ${String(toScroll)} ms`,
  });
  // Ten times the invoices may cost at most twice the time, plus half a second.
  expect(scaled).toBeLessThan(baseline * 2 + 500);
  expect(toScroll).toBeLessThan(1500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
