import { expect, type Page, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  withoutExpectedNotices,
} from '../support';

/**
 * The demo, against the real server and the PayPal sandbox (CONTEXT.md, "Demo scenario"). It runs
 * in order on one freshly seeded server. Figures the demo promises are checked softly: a different
 * figure is reported, and the run carries on, so one run shows every difference.
 *
 * Paying on PayPal is a person's step. Set REAL_WAIT_FOR_PAYMENT=1 to have the run wait while you
 * pay Juniper's invoice in the sandbox; it then checks the verified webhook marks the deal paid.
 */

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";
const BUSINESSES = [
  'Maya Studio',
  'Juniper Labs',
  'Harbor & Co',
  'Oak Street Bakery',
  'Pinecrest Dental',
  'Birch Legal',
];

test.describe.configure({ mode: 'serial' });

async function asOwner(page: Page) {
  await chooseBusiness(page, /Maya Studio/);
  await expect(page.getByRole('heading', { name: 'Workbench', level: 1 })).toBeVisible();
}

test('the server is up and the demo is freshly seeded', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);

  await page.goto('/');
  for (const name of BUSINESSES) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole('button', { name: /Maya Studio/ }).click();
  // A fresh seed has no goal yet. If this fails, reseed: pnpm seed --reset --suffix <new>.
  await expect(page.getByLabel(/What cash do you need/)).toBeVisible();
});

test('the owner states the goal, and the plan is the demo’s', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  await asOwner(page);
  await page.getByLabel(/What cash do you need/).fill(SENTENCE);
  await page.getByRole('button', { name: 'Read my goal' }).click();

  const understood = page.getByRole('group', { name: 'What I understood' });
  await expect(understood).toBeVisible();
  await expect.soft(understood).toContainText('Amount$6,200');
  await expect.soft(understood).toContainText('Max discount1.2%');
  await expect.soft(understood).toContainText('Target$6,510');
  await expect
    .soft(page.getByRole('group', { name: 'Do not contact' }))
    .toContainText(/Pinecrest Dental.*Birch Legal|Birch Legal.*Pinecrest Dental/);

  await page.getByRole('button', { name: 'Confirm and build plan' }).click();
  const rail = page.getByRole('region', { name: 'Plan summary' });
  await expect(rail).toBeVisible();
  const grid = page.getByTestId('workbench-grid');
  for (const client of ['Juniper Labs', 'Harbor & Co', 'Oak Street Bakery']) {
    await expect(grid.getByText(client).first()).toBeVisible();
  }
  // The planner's demo plan: $54 planned now, $61 once Harbor's counter is approved.
  await expect.soft(rail).toContainText('$54.00');

  expect(withoutExpectedNotices(errors)).toEqual([]);
  await expectNoA11yViolations(page);
});

test('approving the plan starts the negotiation, and Harbor’s counter comes back to the owner', async ({
  page,
}) => {
  await asOwner(page);
  const rail = page.getByRole('region', { name: 'Plan summary' });
  await rail.getByRole('button', { name: 'Approve plan' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve plan' }).click();
  await expect(rail).toContainText('Plan approved');

  await page.getByRole('link', { name: 'Negotiation Room' }).click();
  // The server negotiates in the background; the card arrives over the live stream.
  const card = page.getByRole('region', { name: /Needs your approval/ });
  await expect(card).toBeVisible({ timeout: 3 * 60_000 });
  await expect.soft(card).toContainText('Harbor & Co');
  await expect.soft(card).toContainText('+$1.00');
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(card).toHaveCount(0);

  // Harbor accepts at 1.2%, and the agreed terms go onto its PayPal invoice.
  const settlement = page.getByRole('region', { name: 'Settlement on PayPal' });
  await expect(settlement).toContainText('PUT /v2/invoicing/invoices/{id}', {
    timeout: 3 * 60_000,
  });
});

test('Juniper’s person approves the payment, and PayPal’s invoice opens in a new tab', async ({
  page,
  context,
}) => {
  await chooseBusiness(page, /Juniper Labs/);
  await expect(page.getByRole('heading', { name: 'Payables Desk', level: 1 })).toBeVisible();
  const card = page.getByRole('region', { name: /Needs your approval/ });
  await expect(card).toBeVisible({ timeout: 2 * 60_000 });
  await expect.soft(card).toContainText('$4,960.00');

  const opened = context.waitForEvent('page');
  await card.getByRole('button', { name: 'Approve payment' }).click();
  const tab = await opened;
  await tab.waitForLoadState('domcontentloaded');
  expect(new URL(tab.url()).hostname).toMatch(/(^|\.)paypal\.com$/);
  test.info().annotations.push({ type: 'pay here', description: tab.url() });

  // Not paid until PayPal says so.
  const paying = page.getByRole('region', { name: 'Being paid' });
  await expect(paying.getByText('Waiting for PayPal confirmation')).toBeVisible();

  if (process.env['REAL_WAIT_FOR_PAYMENT'] === '1') {
    // Pay the invoice in the sandbox tab as Juniper's person; the webhook needs a public URL.
    await expect(page.getByText('Payment confirmed by PayPal')).toBeVisible({
      timeout: 10 * 60_000,
    });
  }
});

test('the audit trail shows the PayPal calls with their IDs', async ({ page }) => {
  await asOwner(page);
  await page.getByRole('link', { name: 'Audit trail' }).click();
  await expect(page.getByRole('heading', { name: 'Audit trail', level: 1 })).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByText('PUT /v2/invoicing/invoices/{id}').first()).toBeVisible();
  await expectNoA11yViolations(page);
});

test('Cash Studio answers, or says plainly why it can’t', async ({ page }) => {
  await asOwner(page);
  await page.getByRole('link', { name: 'Cash Studio' }).click();
  const studio = page.getByTestId('cash-studio');
  await studio.getByText('Cap discounts at 1.0%').click();
  // With an AI key the strategist answers; without one the server says it isn't configured.
  const answered = studio.locator('canvas').first();
  const refused = studio.getByText('The cash strategist isn’t available yet', { exact: false });
  await expect(answered.or(refused)).toBeVisible({ timeout: 2 * 60_000 });
  test.info().annotations.push({
    type: 'cash studio',
    description: (await refused.isVisible()) ? 'not configured on this server' : 'answered',
  });
});
