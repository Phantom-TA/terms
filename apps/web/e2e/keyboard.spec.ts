import { expect, type Page, test } from '@playwright/test';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

/** What the focused element shows: an outline, a ring (box-shadow) or a border, if any. */
async function focusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    const ring = style.boxShadow !== 'none';
    // AG Grid draws its focus inside the cell or row with a border or an inset ring.
    const inGrid = Boolean(el.closest('.ag-root-wrapper'));
    // AG Charts focuses a copy of the chart's canvas, shown only while it has keyboard focus, with
    // its focus ring drawn on it. It counts only if it is actually showing.
    const chart = el.classList.contains('ag-charts-swapchain') && style.opacity === '1';
    const label = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
    const where = `${el.getAttribute('role') ?? ''} ${typeof el.className === 'string' ? el.className.slice(0, 60) : ''}`;
    return {
      label: `${el.tagName} ${label} [${where.trim()}]`,
      visible: outline || ring || inGrid || chart,
    };
  });
}

/** Tabs through `stops` focus stops and returns the labels of any with no visible indicator. */
async function stopsWithoutFocusRing(page: Page, stops: number): Promise<string[]> {
  const missing: string[] = [];
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press('Tab');
    const found = await focusIndicator(page);
    if (found && !found.visible) missing.push(found.label);
  }
  return missing;
}

async function chooseMaya(page: Page) {
  await page.goto('/');
  const maya = page.getByRole('button', { name: /Maya Studio/ });
  await maya.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/What cash do you need/)).toBeVisible();
}

test.describe('Keyboard only', () => {
  test('the owner sets a goal, builds a plan and approves it without a mouse', async ({ page }) => {
    await chooseMaya(page);
    const goal = page.getByLabel(/What cash do you need/);
    await goal.focus();
    await page.keyboard.type(SENTENCE);
    await page.getByRole('button', { name: 'Read my goal' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Confirm and build plan' }).focus();
    await page.keyboard.press('Enter');

    const rail = page.getByRole('region', { name: 'Plan summary' });
    const approve = rail.getByRole('button', { name: 'Approve plan' });
    await approve.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Focus is inside the dialog, Escape closes it and focus goes back to the button.
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(approve).toBeFocused();

    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Approve plan' }).focus();
    await page.keyboard.press('Enter');
    await expect(rail).toContainText('Plan approved');
  });

  test('every stop on the Workbench shows where focus is', async ({ page }) => {
    await chooseMaya(page);
    await page.getByLabel(/What cash do you need/).fill(SENTENCE);
    await page.getByRole('button', { name: 'Read my goal' }).click();
    await page.getByRole('button', { name: 'Confirm and build plan' }).click();
    await expect(page.getByRole('region', { name: 'Plan summary' })).toBeVisible();
    await page.locator('body').focus();
    expect(await stopsWithoutFocusRing(page, 60)).toEqual([]);
  });

  test('every stop on the Payables Desk and Settings shows where focus is', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Juniper Labs/ }).click();
    await expect(page.getByRole('heading', { name: 'Payables Desk', level: 1 })).toBeVisible();
    expect(await stopsWithoutFocusRing(page, 40)).toEqual([]);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    expect(await stopsWithoutFocusRing(page, 40)).toEqual([]);
  });

  test('every stop in the Negotiation Room shows where focus is, and a counter is approved by keyboard', async ({
    page,
  }) => {
    await chooseMaya(page);
    await page.getByLabel(/What cash do you need/).fill(SENTENCE);
    await page.getByRole('button', { name: 'Read my goal' }).click();
    await page.getByRole('button', { name: 'Confirm and build plan' }).click();
    const rail = page.getByRole('region', { name: 'Plan summary' });
    await rail.getByRole('button', { name: 'Approve plan' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve plan' }).click();
    await page.getByRole('link', { name: 'Negotiation Room' }).click();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.__termsMockNegotiate?.();
    });
    const card = page.getByRole('region', { name: /Needs your approval/ });
    await expect(card).toBeVisible();
    expect(await stopsWithoutFocusRing(page, 40)).toEqual([]);

    await card.getByRole('button', { name: 'Approve', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
  });
});
