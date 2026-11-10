import { expect, type Page, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

/** The owner approves a plan and the agents negotiate, then the visitor becomes Juniper Labs. */
async function asJuniperWithAnOffer(page: Page): Promise<void> {
  await chooseBusiness(page, /Maya Studio/);
  await page.getByLabel(/What cash do you need/).fill(SENTENCE);
  await page.getByRole('button', { name: 'Read my goal' }).click();
  await page.getByRole('button', { name: 'Confirm and build plan' }).click();
  const rail = page.getByRole('region', { name: 'Plan summary' });
  await rail.getByRole('button', { name: 'Approve plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve plan' }).click();
  await expect(rail).toContainText('Plan approved');
  await page.evaluate(() => {
    window.__termsMockNegotiate?.();
  });
  await page.getByLabel('Acting as').selectOption({ label: 'Juniper Labs' });
  await expect(page).toHaveURL(/\/payables$/);
}

test.describe('a client', () => {
  test('lands on the Payables Desk with offers ranked by return', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await asJuniperWithAnOffer(page);
    await expect(page.getByRole('heading', { name: 'Payables Desk', level: 1 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText([
      'Payables Desk',
      /^Approvals/,
      'Audit trail',
      'Settings',
    ]);

    const grid = page.getByTestId('offers-grid');
    const row = grid.getByRole('row', { name: /Maya Studio/ });
    await expect(row).toContainText('Needs a person');
    await expect(row).toContainText('% a year');
    await expect(
      page.getByRole('region', { name: /Needs your approval: Approve the \$4,960\.00/ }),
    ).toBeVisible();

    // The conversation behind the offer opens under its row.
    await row.locator('.ag-group-contracted').click();
    await expect(grid.getByRole('heading', { name: 'What has been said' })).toBeVisible();
    await expect(grid.getByRole('article').first()).toBeVisible();

    await waitForAnimations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('approves a payment over its limit on PayPal', async ({ page }) => {
    await asJuniperWithAnOffer(page);
    const card = page.getByRole('region', { name: /Needs your approval: Approve the \$4,960\.00/ });
    await card.getByRole('button', { name: 'Approve in PayPal' }).click();
    await expect(page).toHaveURL(/\/mock-paypal\?kind=payment/);
    await expect(page.getByRole('heading', { name: 'Approve this payment' })).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  });

  test('saves a PayPal method by approving it on PayPal', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await chooseBusiness(page, /Juniper Labs/);
    const vault = page.locator('section', {
      has: page.getByRole('heading', { name: 'Saved PayPal method' }),
    });
    await expect(vault).toContainText('Not saved');
    await vault.getByRole('button', { name: 'Save a PayPal method' }).click();
    await expect(page).toHaveURL(/\/mock-paypal\?kind=vault/);
    await page.getByRole('button', { name: 'Approve' }).click();

    await expect(page.getByText('PayPal method saved')).toBeVisible();
    await expect(page).toHaveURL(/\/payables$/);
    await expect(vault).toContainText('Saved');
    await expect(vault).toContainText('juniper@business.example.com');
    expect(withoutExpectedNotices(errors)).toEqual([]);
  });

  test('is told nothing was saved after cancelling on PayPal', async ({ page }) => {
    await chooseBusiness(page, /Juniper Labs/);
    await page.getByRole('button', { name: 'Save a PayPal method' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Nothing was saved', level: 1 })).toBeVisible();
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
    await page.getByRole('link', { name: 'Back to the Payables Desk' }).click();
    await expect(page.getByRole('heading', { name: 'Payables Desk', level: 1 })).toBeVisible();
  });

  test('edits its agent’s policy', async ({ page }) => {
    await chooseBusiness(page, /Harbor & Co/);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    // The Payables Desk has the same form; wait until Settings is the page.
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    const hurdle = page.getByLabel('Hurdle rate (% a year)');
    await hurdle.fill('14');
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Policy saved')).toBeVisible();
    await expect(hurdle).toHaveValue('14');
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
  });
});
