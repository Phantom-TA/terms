import { expect, test } from '@playwright/test';
import {
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

test.describe('public offer page', () => {
  test('shows the offer without a session, and accepts it', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('/offer/demo-oak');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pay $4,950.00 by');
    // Outside the app: no navigation, no business switcher.
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByLabel('Acting as')).toHaveCount(0);
    await waitForAnimations(page);
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Pay now with PayPal' }).click();
    const reply = page.getByRole('region', { name: 'Reply sent' });
    await expect(reply).toContainText('updating the PayPal invoice');
    await expect(reply).toContainText('Waiting for PayPal confirmation');
    await expect(page.getByRole('heading', { name: 'Reply sent' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Pay now with PayPal' })).toHaveCount(0);
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
  });

  test('pays part now, and refuses a part below the minimum', async ({ page }) => {
    await page.goto('/offer/demo-oak');
    await page.getByRole('button', { name: 'Pay part now' }).click();
    const amount = page.getByLabel('Amount to pay now, before the discount');
    await amount.fill('100');
    await page.getByRole('button', { name: 'Pay this part' }).click();
    await expect(page.getByText(/Choose an amount from 500\.00/)).toBeVisible();
    await amount.fill('2000');
    await page.getByRole('button', { name: 'Pay this part' }).click();
    await expect(page.getByRole('region', { name: 'Reply sent' })).toContainText('$1,980.00');
  });

  test('reads a written reply, and shows how', async ({ page }) => {
    await page.goto('/offer/demo-oak');
    await page.getByLabel('Or write a reply').fill('Can pay half Monday.');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByRole('region', { name: 'Reply sent' })).toContainText(
      'We read your note as: $2,500 on Monday.',
    );
  });

  test('explains an ended offer and a used link', async ({ page }) => {
    await page.goto('/offer/demo-expired');
    await expect(page.getByText(/This offer has ended/)).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);

    await page.goto('/offer/demo-used');
    await expect(
      page.getByRole('heading', { name: 'This link can’t be used', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('This link has already been used.')).toBeVisible();
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
  });
});
