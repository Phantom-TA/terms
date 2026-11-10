import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  chooseBusiness,
  expectNoA11yViolations,
  trackConsoleErrors,
  waitForAnimations,
  withoutExpectedNotices,
} from './support';

const SENTENCE = "I need $6,200 by Friday. Max 1.2%. Don't contact Pinecrest or Birch.";

const grid = (page: Page) => page.getByTestId('workbench-grid');

/** One cell of one invoice row. A row spans the pinned and scrolling panes, so address it by id. */
const cell = (page: Page, invoiceId: string, colId: string): Locator =>
  grid(page).locator(`[row-id="${invoiceId}"] [col-id="${colId}"]`);

/**
 * The group names in the order they appear on screen. AG Grid positions rows absolutely, so the
 * DOM order isn't the visual order; the row index is.
 */
const groupOrder = (page: Page): Promise<string[]> =>
  grid(page).evaluate((el) =>
    [...el.querySelectorAll('.ag-row-level-0.ag-row-group')]
      .sort(
        (a, b) => Number(a.getAttribute('aria-rowindex')) - Number(b.getAttribute('aria-rowindex')),
      )
      .map((row) => (row.getAttribute('row-id') ?? '').replace('row-group-group-', '')),
  );

const pinnedTotal = (page: Page, colId: string): Locator =>
  grid(page).locator(`.ag-row-pinned [col-id="${colId}"]`);

async function buildPlan(page: Page): Promise<void> {
  await chooseBusiness(page, /Maya Studio/);
  await page.getByLabel(/What cash do you need/).fill(SENTENCE);
  await page.getByRole('button', { name: 'Read my goal' }).click();
  await page.getByRole('button', { name: 'Confirm and build plan' }).click();
  await expect(cell(page, 'inv_juniper', 'discount')).toContainText('0.8%');
}

async function editText(page: Page, target: Locator, value: string): Promise<void> {
  await target.click();
  const input = page.locator('.ag-cell-inline-editing input');
  await expect(input).toBeVisible();
  await input.fill(value);
  await input.press('Enter');
}

test.describe('Workbench', () => {
  test('turns a sentence into a plan, grouped by action, with protected clients apart', async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await chooseBusiness(page, /Maya Studio/);

    // Before any goal, the owner sees the goal box and the invoices.
    await expect(page.getByLabel(/What cash do you need/)).toBeVisible();
    await expect(grid(page).getByText('Juniper Labs')).toBeVisible();

    await page.getByLabel(/What cash do you need/).fill(SENTENCE);
    await page.getByRole('button', { name: 'Read my goal' }).click();

    const goal = page.getByRole('region', { name: 'Your goal' });
    await expect(goal.getByRole('group', { name: 'What I understood' })).toContainText('$6,200');
    await expect(goal.getByRole('group', { name: 'What I understood' })).toContainText(
      'Target$6,510',
    );
    await expect(goal).toContainText('Payroll of $11,400 lands Friday');
    await expect(goal.getByRole('group', { name: 'Do not contact' })).toContainText(
      'Pinecrest Dental',
    );

    await page.getByRole('button', { name: 'Confirm and build plan' }).click();
    await expect(cell(page, 'inv_juniper', 'discount')).toContainText('0.8%');

    // Grouped by action, offers first and protected clients last.
    await expect.poll(() => groupOrder(page)).toEqual(['Negotiate', 'Reminder', 'Do not contact']);

    await expect(cell(page, 'inv_juniper', 'ask')).toContainText('$5,000.00');
    await expect(cell(page, 'inv_juniper', 'ask').locator('s')).toContainText('$5,000.00');
    await expect(cell(page, 'inv_juniper', 'ask')).toContainText('$4,960.00');
    await expect(cell(page, 'inv_harbor', 'ask')).toContainText('$1,750.00');
    await expect(cell(page, 'inv_oak', 'committed')).toContainText('Best effort, not counted');
    await expect(cell(page, 'inv_juniper', 'dealState')).toContainText('Suggested');
    await expect(cell(page, 'inv_pinecrest', 'contact')).toContainText('Do not contact');
    await expect(cell(page, 'inv_birch', 'contact')).toContainText('Do not contact');

    // The server's policy checks: protected clients are blocked, the rest pass.
    await expect(cell(page, 'inv_pinecrest', 'policy')).toContainText('Do not contact');
    await expect(cell(page, 'inv_pinecrest', 'policy')).toContainText('blocked');
    await expect(cell(page, 'inv_juniper', 'policy')).toContainText(/All \d+ passed/);

    // Pinned summary row, from the server's totals. Nothing is committed yet.
    await expect(pinnedTotal(page, 'cost')).toHaveText('$54.00');
    await expect(pinnedTotal(page, 'committed')).toHaveText('$0.00');

    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test('blocks Harbor at 1.5%, says which rule, and leaves the plan unchanged', async ({
    page,
  }) => {
    await buildPlan(page);
    await editText(page, cell(page, 'inv_harbor', 'discount'), '1.5');

    const alert = page.getByRole('region', { name: 'Notifications' }).getByRole('alert');
    await expect(alert).toContainText('Harbor & Co: not changed');
    await expect(alert).toContainText('1.50% is above the 1.20% maximum');
    await expect(cell(page, 'inv_harbor', 'discount')).toContainText('0.8%');
    await expect(pinnedTotal(page, 'cost')).toHaveText('$54.00');
  });

  test('accepts 1.2% for Harbor, shows the server’s new total and that approval is needed', async ({
    page,
  }) => {
    await buildPlan(page);
    await editText(page, cell(page, 'inv_harbor', 'discount'), '1.2');

    const status = page.getByRole('region', { name: 'Notifications' }).getByRole('status');
    await expect(status).toContainText('Harbor & Co updated');
    await expect(status).toContainText('$1.00 over the $60.00 ceiling');
    await expect(cell(page, 'inv_harbor', 'discount')).toContainText('1.2%');
    await expect(pinnedTotal(page, 'cost')).toHaveText('$61.00');
    await expect(cell(page, 'inv_harbor', 'policy')).toContainText('needs approval');
  });

  test('changes an action with the select, and the row moves group', async ({ page }) => {
    await buildPlan(page);
    await cell(page, 'inv_oak', 'action').click();
    const select = page.getByRole('combobox', { name: 'Action' });
    await expect(select).toBeVisible();
    await expect(select.getByRole('option')).toHaveText([
      'No action',
      'Reminder',
      'Partial payment',
      'Early-payment discount',
    ]);
    await select.selectOption('NONE');

    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByRole('status'),
    ).toContainText('Oak Street Bakery updated');
    await expect(cell(page, 'inv_oak', 'action')).toContainText('No action');
    await expect.poll(() => groupOrder(page)).toEqual(['Negotiate', 'No action', 'Do not contact']);
  });

  test('refuses to discount an overdue invoice', async ({ page }) => {
    await buildPlan(page);
    await cell(page, 'inv_oak', 'action').click();
    await page.getByRole('combobox', { name: 'Action' }).selectOption('EARLY_DISCOUNT');
    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByRole('alert'),
    ).toContainText('Overdue invoices never get a discount');
    await expect(cell(page, 'inv_oak', 'action')).toContainText('Reminder');
  });

  test('keeps protected clients locked', async ({ page }) => {
    await buildPlan(page);
    await cell(page, 'inv_pinecrest', 'action').click();
    await expect(page.getByRole('combobox', { name: 'Action' })).toHaveCount(0);
    await cell(page, 'inv_pinecrest', 'discount').click();
    await expect(page.locator('.ag-cell-inline-editing')).toHaveCount(0);
  });

  test('opens a row to show why the planner chose it', async ({ page }) => {
    await buildPlan(page);
    await expect(page.getByTestId('detail-inv_juniper')).toHaveCount(0);
    await grid(page).locator('[row-id="inv_juniper"] .ag-group-contracted').first().click();
    const detail = page.getByTestId('detail-inv_juniper');
    await expect(detail).toContainText('Cheapest way to commit a whole invoice');
    await expect(detail).toContainText('earns 16.4% a year for paying 18 days early');
    await expect(detail).toContainText('Nothing is sent until you approve the plan');
    await waitForAnimations(page);
    await expectNoA11yViolations(page);
  });

  test('says protected clients are never messaged', async ({ page }) => {
    await buildPlan(page);
    await grid(page).locator('[row-id="inv_pinecrest"] .ag-group-contracted').first().click();
    await expect(page.getByTestId('detail-inv_pinecrest')).toContainText(
      'Terms will never message this client',
    );
  });

  test('lets the owner hide a column from the column picker', async ({ page }) => {
    await buildPlan(page);
    const header = grid(page).getByRole('columnheader', { name: 'Discount' });
    await expect(header).toBeVisible();
    await grid(page).getByRole('tab', { name: 'Columns' }).click();
    await expect(grid(page).locator('.ag-column-select-column-label')).not.toContainText(['Group']);
    // AG Grid hides the native checkbox and labels every one the same way, so find the row by the
    // column's name and click its checkbox wrapper, as a person would.
    const toggle = grid(page)
      .locator('.ag-column-select-column')
      .filter({ has: page.locator('.ag-column-select-column-label', { hasText: /^Discount$/ }) })
      .locator('.ag-checkbox-input-wrapper');
    await toggle.click();
    await expect(header).toHaveCount(0);
    await toggle.click();
    await expect(header).toBeVisible();
  });

  test('saving one row leaves an edit open in another row alone', async ({ page }) => {
    await buildPlan(page);
    await page.evaluate(() => {
      sessionStorage.setItem('terms.mock.slowEdit', '600');
    });
    await editText(page, cell(page, 'inv_harbor', 'discount'), '1.0');

    // While Harbor is saving, start typing in Juniper's row and don't finish.
    await cell(page, 'inv_juniper', 'discount').click();
    const input = page.locator('.ag-cell-inline-editing input');
    await input.fill('0.9');

    const toasts = page.getByRole('region', { name: 'Notifications' }).getByRole('status');
    await expect(toasts.filter({ hasText: 'Harbor & Co updated' })).toBeVisible();

    // Harbor's new value arrived, while the half-typed one is still there and nothing was sent.
    await expect(cell(page, 'inv_harbor', 'discount')).toContainText('1%');
    await expect(input).toHaveValue('0.9');
    await expect(toasts.filter({ hasText: 'Juniper Labs updated' })).toHaveCount(0);

    await input.press('Escape');
    await expect(cell(page, 'inv_juniper', 'discount')).toContainText('0.8%');
  });

  test('shows the backups in the row they belong to', async ({ page }) => {
    await buildPlan(page);
    await grid(page).locator('[row-id="inv_harbor"] .ag-group-contracted').first().click();
    await expect(page.getByRole('list', { name: 'Backup offers' })).toContainText(
      'Backup 1: $2,500.00 at 0.8%',
    );
  });

  test('draws the runway before and after the plan, with the payroll line labelled', async ({
    page,
  }) => {
    const errors = trackConsoleErrors(page);
    await buildPlan(page);
    const chart = page.getByTestId('runway-chart');
    await expect(chart).toBeVisible();
    await expect(chart.locator('canvas').first()).toBeVisible();
    // A canvas can't be read aloud, so the wrapper says what it shows, from the server's figures.
    await expect(chart).toHaveAccessibleName('Cash runway chart');
    await expect(chart).toHaveAccessibleDescription(
      'Cash runway chart. Payroll of $11,400.00 lands Fri, Nov 13. On that day the balance is -$6,200.00 with no plan, $496.00 if every offer is accepted, and -$6,200.00 from committed cash so far.',
    );
    await waitForAnimations(page);
    // AG Charts reports configuration problems by throwing in development, which shows up here.
    expect(withoutExpectedNotices(errors)).toEqual([]);
    await expectNoA11yViolations(page);
  });

  test('can hide the chart to give the grid room', async ({ page }) => {
    await buildPlan(page);
    await expect(page.getByTestId('runway-chart')).toBeVisible();
    await page.getByText('Cash runway', { exact: true }).click();
    await expect(page.getByTestId('runway-chart')).toBeHidden();
    await page.getByText('Cash runway', { exact: true }).click();
    await expect(page.getByTestId('runway-chart')).toBeVisible();
  });

  test('approves the plan with a cost ceiling, then locks it', async ({ page }) => {
    await buildPlan(page);
    const rail = page.getByRole('region', { name: 'Plan summary' });
    await expect(rail).toContainText('Planned, not committed$6,696.00');
    await expect(rail).toContainText('Nothing is sent until you approve.');

    await rail.getByRole('button', { name: 'Approve plan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve this plan?' });
    await expect(dialog).toContainText('Send 2 offers worth $6,696.00');
    await expect(dialog).toContainText('Send 1 reminder');
    await expect(dialog).toContainText('Protected clients are never contacted');
    await expectNoA11yViolations(page);

    await dialog.getByLabel('Cost ceiling').fill('75');
    await dialog.getByRole('button', { name: 'Approve plan' }).click();

    await expect(
      page.getByRole('region', { name: 'Notifications' }).getByRole('status'),
    ).toContainText('Plan approved');
    await expect(dialog).toBeHidden();
    await expect(rail).toContainText('Plan approved');
    await expect(rail).toContainText('ceiling $75.00');
    await expect(rail.getByRole('button', { name: 'Approve plan' })).toHaveCount(0);

    // Nothing is committed just because the owner approved. Only agreed or paid cash counts.
    await expect(rail).toContainText('Committed$0.00');
    await expect(cell(page, 'inv_juniper', 'dealState')).toContainText('Approved');
    await expect(cell(page, 'inv_juniper', 'approval')).toContainText('Approved by you');

    // The plan is now locked.
    await cell(page, 'inv_harbor', 'discount').click();
    await expect(page.locator('.ag-cell-inline-editing')).toHaveCount(0);
    await cell(page, 'inv_harbor', 'action').click();
    await expect(page.getByRole('combobox', { name: 'Action' })).toHaveCount(0);
  });

  test('says when an edit takes the plan over the ceiling, and lets the owner raise it', async ({
    page,
  }) => {
    await buildPlan(page);
    await editText(page, cell(page, 'inv_harbor', 'discount'), '1.2');
    await expect(pinnedTotal(page, 'cost')).toHaveText('$61.00');

    const rail = page.getByRole('region', { name: 'Plan summary' });
    await expect(rail).toContainText('$61.00 planned · ceiling $60.00');
    await rail.getByRole('button', { name: 'Approve plan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve this plan?' });
    await expect(dialog).toContainText(
      'costs $61.00 if every offer is accepted, which is above this ceiling',
    );
    await dialog.getByLabel('Cost ceiling').fill('61');
    await expect(dialog).not.toContainText('which is above this ceiling');
    await dialog.getByRole('button', { name: 'Approve plan' }).click();
    await expect(rail).toContainText('Plan approved');
    await expect(rail).toContainText('ceiling $61.00');
  });

  test('cancelling the approval changes nothing', async ({ page }) => {
    await buildPlan(page);
    const rail = page.getByRole('region', { name: 'Plan summary' });
    await rail.getByRole('button', { name: 'Approve plan' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(rail.getByRole('button', { name: 'Approve plan' })).toBeVisible();
    await expect(cell(page, 'inv_juniper', 'dealState')).toContainText('Suggested');
  });

  test('shows what the server sends as it arrives, without a reload', async ({ page }) => {
    await buildPlan(page);
    const rail = page.getByRole('region', { name: 'Plan summary' });
    await rail.getByRole('button', { name: 'Approve plan' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve plan' }).click();
    await expect(rail).toContainText('Plan approved');
    await expect(rail).toContainText('Committed$0.00');

    // Nothing is committed by approving. Only a server event can say a deal is agreed. These events
    // are injected through the mock stream, shaped exactly as the API's would be.
    await page.evaluate(async () => {
      const emit = window.__termsMockEmit;
      if (!emit) throw new Error('Mock stream is not available');
      const at = new Date().toISOString();
      const { deals } = (await (await fetch('/api/deals')).json()) as {
        deals: { id: string; invoiceId: string }[];
      };
      const juniper = deals.find((d) => d.invoiceId === 'inv_juniper');
      const { plan } = (await (await fetch('/api/plans/plan_1')).json()) as {
        plan: { summary: Record<string, unknown> };
      };
      emit({
        id: 'live-1',
        type: 'deal.updated',
        at,
        data: { deal: { ...juniper, state: 'AGREED', countsAsCommitted: true } },
      });
      emit({
        id: 'live-2',
        type: 'plan.updated',
        at,
        data: {
          planId: 'plan_1',
          status: 'APPROVED',
          summary: {
            ...plan.summary,
            committed: '4960.00',
            costSoFar: '40.00',
            remaining: '1550.00',
          },
        },
      });
    });

    await expect(cell(page, 'inv_juniper', 'dealState')).toContainText('Agreed');
    await expect(cell(page, 'inv_juniper', 'committed')).toContainText('$4,960.00');
    await expect(cell(page, 'inv_juniper', 'committed').locator('span').first()).toHaveClass(
      /text-committed-strong/,
    );
    await expect(cell(page, 'inv_harbor', 'committed')).toHaveText('');
    await expect(rail).toContainText('Committed$4,960.00');
    await expect(rail).toContainText('$1,550.00 still to commit');
    await expect(pinnedTotal(page, 'committed')).toHaveText('$4,960.00');
    await expect(rail).toContainText('Cost so far$40.00');

    await page.evaluate(() => {
      window.__termsMockEmit?.({
        id: 'live-3',
        type: 'goal.met',
        at: new Date().toISOString(),
        data: {
          goalId: 'goal_1',
          planId: 'plan_1',
          target: '6510.00',
          committed: '6689.00',
          cost: '61.00',
          withdrawnDealIds: [],
        },
      });
    });
    await expect(
      page
        .getByRole('region', { name: 'Notifications' })
        .getByRole('status')
        .filter({ hasText: 'Goal met' }),
    ).toContainText('$6,689.00 is committed against a $6,510.00 target');
  });

  test('fits the screen: the page never scrolls sideways', async ({ page }) => {
    await buildPlan(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('keeps the outcome columns reachable at either width', async ({ page }, info) => {
    await buildPlan(page);
    const dealState = cell(page, 'inv_juniper', 'dealState');
    if (info.project.name === 'laptop') {
      // Pinned right: in view without scrolling.
      await expect(dealState).toBeInViewport();
      await expect(cell(page, 'inv_juniper', 'approval')).toBeInViewport();
    } else {
      // Tablet: the decision columns keep their room, and the outcomes are a scroll away.
      await expect(cell(page, 'inv_juniper', 'action')).toBeInViewport();
      await expect(cell(page, 'inv_juniper', 'discount')).toBeInViewport();
      await grid(page)
        .locator('.ag-body-horizontal-scroll-viewport')
        .evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
      await expect(dealState).toBeInViewport();
    }
  });
});
