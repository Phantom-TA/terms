import { expect, type Page, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

/** How much of the first chart in Studio's canvas has been painted; 0 before it draws. */
function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.ag-studio-layout-widget canvas');
    const pixels = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return 0;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 0) painted += 1;
    return painted;
  });
}

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

    // The answer arrives through POST /api/studio/turn with the what-if runway, which fills the
    // scenario table before Studio runs the widget calls that chart it.
    await expect(
      studio.getByText('I’ll chart the runway under that what-if', { exact: false }),
    ).toBeVisible();
    await expect(studio.getByText('Cash runway, with discounts capped').first()).toBeVisible();
    await expect(studio.getByText('this what-if is a stand-in', { exact: false })).toBeVisible();
    // Drawn from the what-if rows. A chart that can't draw paints under 1,000 pixels (its frame);
    // a drawn one about 12,000.
    await expect.poll(() => paintedPixels(page), { timeout: 10_000 }).toBeGreaterThan(5000);

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
