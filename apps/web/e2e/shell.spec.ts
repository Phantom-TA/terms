import { expect, test } from '@playwright/test';
import { chooseBusiness, expectNoA11yViolations } from './support';

test('picks a business from the session picker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who are you in this demo?' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Environment' })).toContainText('PayPal sandbox');
  await expectNoA11yViolations(page);

  await page.getByRole('button', { name: /Maya Studio/ }).click();
  await expect(page.getByLabel('Acting as')).toHaveValue('biz_maya');
  await expect(page.getByRole('note', { name: 'Environment' })).toContainText('Demo data');
  await expect(page.getByText('Owner', { exact: true })).toBeVisible();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
});

test('switches between the owner and a client', async ({ page }) => {
  await chooseBusiness(page, /Maya Studio/);
  await expect(page.getByLabel('Acting as')).toHaveValue('biz_maya');
  await page.getByLabel('Acting as').selectOption('biz_harbor');
  await expect(page.getByLabel('Acting as')).toHaveValue('biz_harbor');
  await expect(page.getByText('Client', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Acting as')).toHaveValue('biz_harbor');
});

test('shows the real error with a debug ID and recovers on retry', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem('terms.mock.fail', '1');
  });
  await page.reload();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('PayPal could not be reached.');
  await expect(alert).toContainText('mock-debug-id');
  await expectNoA11yViolations(page);

  await page.evaluate(() => {
    sessionStorage.removeItem('terms.mock.fail');
  });
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Who are you in this demo?' })).toBeVisible();
});

test('shows a way home from an unknown page', async ({ page }) => {
  await chooseBusiness(page, /Maya Studio/);
  await expect(page.getByLabel('Acting as')).toHaveValue('biz_maya');
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Acting as')).toHaveValue('biz_maya');
  await expectNoA11yViolations(page);
  await page.getByRole('link', { name: 'Go to your home screen' }).click();
  await expect(page).toHaveURL(/style-guide/);
});

test('skip link is the first stop for keyboard users', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who are you in this demo?' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
});
