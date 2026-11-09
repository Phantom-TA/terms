import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, trackConsoleErrors, withoutExpectedNotices } from './support';

test.beforeEach(async ({ page }) => {
  await page.goto('/style-guide');
  await expect(page.getByRole('heading', { name: 'Style guide', level: 1 })).toBeVisible();
});

test('renders the design system with no accessibility violations', async ({ page }) => {
  await expect(page.getByText('Needs you').first()).toBeVisible();
  await expect(page.getByTestId('grid-specimen')).toContainText('Juniper Labs');
  await expectNoA11yViolations(page);
});

test('renders custom cell renderers inside AG Grid', async ({ page }) => {
  const grid = page.getByTestId('grid-specimen');
  await expect(grid.getByText('Awaiting payment')).toBeVisible();
  await expect(grid.locator('s').first()).toContainText('$5,000.00');
  await expect(grid.getByText('$4,960.00').first()).toBeVisible();
  await expect(grid.getByRole('row')).toHaveCount(5);
});

test('has no console errors', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await page.reload();
  await expect(page.getByTestId('grid-specimen')).toContainText('Juniper Labs');
  expect(withoutExpectedNotices(errors)).toEqual([]);
});

test('opens and closes a dialog, returning focus', async ({ page }) => {
  const open = page.getByRole('button', { name: 'Open dialog' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Approve this counter?' });
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test('shows and dismisses an error toast', async ({ page }) => {
  await page.getByRole('button', { name: 'Show error toast' }).click();
  const toast = page.getByRole('region', { name: 'Notifications' }).getByRole('alert');
  await expect(toast).toContainText('sample-debug-id');
  await toast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(toast).toBeHidden();
});

test('edits a chip in place', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit Amount: $6200' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('6500');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Edit Amount: $6500' })).toBeVisible();
});

test('has no horizontal overflow at this width', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
