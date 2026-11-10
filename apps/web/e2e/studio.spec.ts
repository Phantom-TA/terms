import { expect, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

test.describe('Cash Studio', () => {
  test('the strategist answers a what-if by building a chart from the owner’s runway', async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await chooseBusiness(page, /Maya Studio/);
    await page.getByRole('link', { name: 'Cash Studio' }).click();
    await expect(page.getByRole('heading', { name: 'Cash Studio', level: 1 })).toBeVisible();

    const studio = page.getByTestId('cash-studio');
    await studio.getByText('Cap discounts at 1.0%').click();

    // The answer arrives through POST /api/studio/turn, and Studio runs the widget calls.
    await expect(studio.getByText('I’ll chart your runway', { exact: false })).toBeVisible();
    await expect(studio.getByText('Cash runway, with your plan').first()).toBeVisible();
    await expect(studio.getByText('the server does that', { exact: false })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await waitForAnimations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test('draws the plan’s cost-versus-cash curve with the custom widget', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await chooseBusiness(page, /Maya Studio/);
    await page
      .getByLabel(/What cash do you need/)
      .fill("I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.");
    await page.getByRole('button', { name: 'Read my goal' }).click();
    await page.getByRole('button', { name: 'Confirm and build plan' }).click();
    await expect(page.getByRole('region', { name: 'Plan summary' })).toBeVisible();
    await page.getByRole('link', { name: 'Cash Studio' }).click();

    const studio = page.getByTestId('cash-studio');
    await studio.getByText('What early cash costs').click();
    // Studio frames the widget as a group named by its title; inside it, the chart.
    const frame = studio.getByRole('group', { name: 'What early cash costs' });
    await expect(frame).toBeAttached();
    const curve = studio.getByRole('group', { name: 'Cost versus cash chart' });
    await expect(curve).toBeVisible();
    await expect(curve).toContainText('What early cash costs');
    await expect(curve).toHaveAccessibleDescription(/^Cheapest cash first\. .+ In all, \$/);
    await expect(curve.locator('canvas').first()).toBeVisible();

    await waitForAnimations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test('a client has no Cash Studio', async ({ page }) => {
    await chooseBusiness(page, /Juniper Labs/);
    await expect(page.getByRole('heading', { name: 'Payables Desk', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cash Studio' })).toHaveCount(0);
  });
});
