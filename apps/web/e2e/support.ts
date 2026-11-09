import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Runs axe on the whole page, including colour contrast, which jsdom can't check. */
export async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}

/** Collects console errors, and AG Grid's validation warnings, from before the first navigation. */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    const isAgWarning = message.type() === 'warning' && message.text().startsWith('AG Grid');
    if (message.type() === 'error' || isAgWarning) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * Removes what is expected in this environment: AG Grid's banner when no trial key is set (the
 * grid still works, with a watermark), and the browser's note about the 401 that `GET /api/session`
 * returns before a business is chosen.
 */
export function withoutExpectedNotices(errors: readonly string[]): string[] {
  return errors.filter(
    (e) => !/^\*.*\*$/.test(e.trim()) && !e.includes('status of 401 (Unauthorized)'),
  );
}

export async function chooseBusiness(page: Page, name: RegExp): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name }).click();
}

/** Waits for every CSS animation and transition to finish, so colours are final before axe reads them. */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
}
