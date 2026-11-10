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

  test('a client has no Cash Studio', async ({ page }) => {
    await chooseBusiness(page, /Juniper Labs/);
    await expect(page.getByRole('heading', { name: 'Payables Desk', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cash Studio' })).toHaveCount(0);
  });
});
