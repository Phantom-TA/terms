import { expect, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

test.describe('the owner’s records and settings', () => {
  test('lists every step in the audit trail, filterable', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await chooseBusiness(page, /Maya Studio/);
    await page.getByLabel(/What cash do you need/).fill(SENTENCE);
    await page.getByRole('button', { name: 'Read my goal' }).click();
    await page.getByRole('button', { name: 'Confirm and build plan' }).click();
    await expect(page.getByRole('region', { name: 'Plan summary' })).toContainText('Approve plan');

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Audit trail' })
      .click();
    const grid = page.getByTestId('audit-grid');
    await expect(grid.getByRole('row', { name: /Plan created/ })).toBeVisible();
    await expect(grid.getByRole('row', { name: /Goal parsed/ })).toBeVisible();

    await page.getByLabel('What').selectOption({ label: 'Plan created' });
    await expect(page.getByText('1 entries shown')).toBeVisible();
    await page.getByLabel('What').selectOption({ label: 'Webhook rejected' });
    await expect(page.getByRole('heading', { name: 'No matching entries' })).toBeVisible();

    await waitForAnimations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test('imports from PayPal', async ({ page }) => {
    await chooseBusiness(page, /Maya Studio/);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Connect & import' })
      .click();
    await expect(page.getByText('maya-studio@business.example.com')).toBeVisible();
    await page.getByRole('button', { name: 'Import from PayPal' }).click();
    await expect(
      page.getByText(/Invoices: 0 new, 1 updated, 6 unchanged, 7 in PayPal/),
    ).toBeVisible();
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
  });

  test('edits the standing policy', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await chooseBusiness(page, /Maya Studio/);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    const max = page.getByLabel('Maximum discount (%)');
    await expect(max).toHaveValue('1.2');
    await max.fill('lots');
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Enter a percentage like 1.2')).toBeVisible();
    await max.fill('1.5');
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Policy saved')).toBeVisible();
    await expect(max).toHaveValue('1.5');
    await waitForAnimations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });
});
