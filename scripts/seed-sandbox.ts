/**
 * Seeds the demo into the PayPal sandbox and the database in DATABASE_URL (CONTEXT.md, "Demo
 * scenario, seed data"). Every object it creates is real: invoices from Maya Studio are created
 * and sent in the sandbox, then imported back through the real sync.
 *
 *   pnpm seed                         first run
 *   pnpm seed --reset --suffix B      a fresh run: cancels the previous run's open invoices,
 *                                     clears the demo history, and numbers invoices 1041-B …
 *   pnpm seed --cancel-stray          also cancels open invoices the seed did not create
 *   pnpm seed --cancel-stray --settle-stray
 *                                     and closes partly paid leftovers by recording what is due
 *   pnpm seed --harbor-token <id>     registers Harbor & Co's saved PayPal method (from a vault setup)
 */
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { formatMoney } from '../packages/shared/src/money.js';
import { loadConfig } from '../apps/api/src/config.js';
import { createDb } from '../apps/api/src/db.js';
import { createLogger } from '../apps/api/src/logger.js';
import { DemoSeed } from '../apps/api/src/seed/demo-seed.js';
import { buildServices } from '../apps/api/src/services.js';

loadDotenv({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const { values } = parseArgs({
  options: {
    reset: { type: 'boolean', default: false },
    'cancel-stray': { type: 'boolean', default: false },
    'settle-stray': { type: 'boolean', default: false },
    suffix: { type: 'string' },
    'harbor-token': { type: 'string' },
  },
});

const config = loadConfig();
if (config.paypal.environment !== 'sandbox')
  throw new Error('The demo seed runs against the PayPal sandbox only');
const db = createDb(config.databaseUrl);
const services = buildServices(config, db, createLogger('warn'));
if (services.paypal === null)
  throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET first');

try {
  const report = await new DemoSeed(db, services.paypal, services.ledger).run({
    reset: values.reset,
    cancelStray: values['cancel-stray'],
    settleStray: values['settle-stray'],
    ...(values.suffix === undefined ? {} : { suffix: values.suffix }),
    ...(values['harbor-token'] === undefined ? {} : { harborPaymentToken: values['harbor-token'] }),
  });
  console.log('Demo seed complete');
  if (report.cancelled.length > 0)
    console.log(`  cancelled ${String(report.cancelled.length)} open invoices`);
  for (const k of report.skipped) console.log(`  left open: ${k.paypalInvoiceId} (${k.reason})`);
  for (const id of report.settled)
    console.log(`  closed partly paid leftover: ${id} (remaining amount recorded as paid)`);
  for (const i of report.invoices) {
    console.log(
      `  invoice ${i.number}: ${i.paypalInvoiceId}${i.created ? ' (created)' : ''}${i.sent ? ', sent' : ''}`,
    );
  }
  console.log(`  payroll $11,400 on ${report.payrollDate}`);
  console.log(
    `  import: ${String(report.sync.invoices.total)} invoices, ${String(report.sync.transactions.total)} transactions, balance ${formatMoney(report.sync.balance.availableCents)} as of ${report.sync.balance.asOf.toISOString()}`,
  );
  console.log(`  Harbor's saved PayPal method: ${report.harborVault}`);
  const stray = await db.invoice.count({
    where: { isDemo: false, paypalStatus: { in: ['SENT', 'UNPAID', 'PARTIALLY_PAID'] } },
  });
  if (stray > 0)
    console.log(
      `  note: ${String(stray)} other open invoices in this PayPal account (run with --cancel-stray to clear them)`,
    );
} finally {
  await db.$disconnect();
}
