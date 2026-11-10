import { expect, type Page, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

async function approvePlan(page: Page): Promise<void> {
  await chooseBusiness(page, /Maya Studio/);
  await page.getByLabel(/What cash do you need/).fill(SENTENCE);
  await page.getByRole('button', { name: 'Read my goal' }).click();
  await page.getByRole('button', { name: 'Confirm and build plan' }).click();
  const rail = page.getByRole('region', { name: 'Plan summary' });
  await rail.getByRole('button', { name: 'Approve plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve plan' }).click();
  await expect(rail).toContainText('Plan approved');
}

async function openRoom(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Negotiation Room' }).click();
  await expect(page.getByRole('heading', { name: 'Negotiation Room', level: 1 })).toBeVisible();
}

async function negotiate(page: Page): Promise<void> {
  // Started after the room is open, so the moves arrive over the stream.
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__termsMockNegotiate?.();
  });
}

test.describe('Negotiation Room', () => {
  test('says nothing has started before a plan is approved', async ({ page }) => {
    await chooseBusiness(page, /Maya Studio/);
    await expect(page.getByLabel(/What cash do you need/)).toBeVisible();
    await openRoom(page);
    await expect(page.getByRole('heading', { name: 'No negotiations yet' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to the Workbench' }).click();
    await expect(page).toHaveURL(/\/workbench$/);
  });

  test('plays the negotiation live, up to the owner’s decision', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await approvePlan(page);
    await openRoom(page);
    await negotiate(page);

    const card = page.getByRole('region', { name: /Needs your approval/ });
    await expect(card).toContainText('Counter to Harbor & Co at 1.20%');
    await expect(card).toContainText('+$1.00');
    await expect(page.getByRole('heading', { name: 'Harbor & Co', level: 2 })).toBeVisible();

    const log = page.getByRole('log', { name: 'Conversation with Harbor & Co' });
    await expect(log.getByRole('article')).toHaveCount(2);
    const counter = log.getByRole('article', { name: /Harbor & Co’s agent: Counter/ });
    await expect(counter).toContainText('23.2% a year');
    await expect(counter).toContainText('We could pay early at 1.5%.');
    // The owner sees its own checks on the counter, never the client's limits.
    await expect(counter).toContainText('Max discount');
    await expect(counter).not.toContainText(/hurdle/i);
    await expect(counter).toContainText('blocked');

    await waitForAnimations(page);
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test('approving sends the counter, closes the deal and meets the goal', async ({ page }) => {
    await approvePlan(page);
    await openRoom(page);
    await negotiate(page);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();

    const log = page.getByRole('log');
    await expect(log.getByRole('article')).toHaveCount(4);
    const accepted = log.getByRole('article', { name: /Harbor & Co’s agent: Accepted/ });
    await expect(accepted).toContainText('18.5% a year');
    await expect(accepted).toContainText('$1,729.00');
    await expect(page.getByRole('region', { name: /Needs your approval/ })).toHaveCount(0);

    await expect(page.getByText('Waiting for PayPal confirmation')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Settlement on PayPal' })).toContainText(
      'PUT /v2/invoicing/invoices/{id}',
    );
    await expect(page.getByRole('region', { name: 'Settlement on PayPal' })).toContainText(
      'POST /v2/checkout/orders',
    );
    await expect(
      page
        .getByRole('region', { name: 'Notifications' })
        .getByRole('status')
        .filter({ hasText: 'Goal met' }),
    ).toContainText('$6,689.00 is committed against a $6,510.00 target, for $61.00');

    // The Workbench shows the same outcome.
    await page.getByRole('link', { name: 'Workbench' }).click();
    const rail = page.getByRole('region', { name: 'Plan summary' });
    await expect(rail).toContainText('Committed$6,689.00');
    await expect(rail).toContainText('Goal met');
  });

  test('rejecting closes the deal and says why', async ({ page }) => {
    await approvePlan(page);
    await openRoom(page);
    await negotiate(page);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByText('You rejected the counter.').first()).toBeVisible();
    await expect(page.getByRole('region', { name: /Needs your approval/ })).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Negotiations' });
    await expect(nav.getByRole('button').first()).toContainText('Juniper Labs');
  });

  test('switches conversation and shows who still has to pay, without the client’s approvals', async ({
    page,
  }) => {
    await approvePlan(page);
    await openRoom(page);
    await negotiate(page);
    await page.getByRole('button', { name: /Juniper Labs/ }).click();
    await expect(page.getByRole('heading', { name: 'Juniper Labs', level: 2 })).toBeVisible();
    await expect(page).toHaveURL(/deal=deal_juniper/);
    const waiting = page.getByRole('status').filter({ hasText: 'Waiting for PayPal' });
    await expect(waiting).toContainText('Juniper Labs pays through PayPal');
    // How the client approves its payment, and its limits, are the client's own.
    await expect(page.getByRole('main')).not.toContainText(/auto-pay|approves the/i);
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
  });

  test('opens from a row on the Workbench', async ({ page }) => {
    await approvePlan(page);
    await page
      .getByTestId('workbench-grid')
      .locator('[row-id="inv_harbor"] .ag-group-contracted')
      .first()
      .click();
    await page.getByRole('link', { name: 'Open in the Negotiation Room' }).click();
    await expect(page).toHaveURL(/deal=deal_harbor/);
    await expect(page.getByRole('heading', { name: 'Harbor & Co', level: 2 })).toBeVisible();
  });

  test('never scrolls the page sideways', async ({ page }) => {
    await approvePlan(page);
    await openRoom(page);
    await negotiate(page);
    await expect(page.getByRole('log').getByRole('article')).toHaveCount(2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
