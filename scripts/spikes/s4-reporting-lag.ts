/**
 * Spike S4 (CONTEXT.md): does Transaction Search return recent sandbox activity in time?
 *
 * Reads the balance snapshot and searches for a known capture (default: the S2 agent payment),
 * then reports how far PayPal's reporting data lags behind now. Run it repeatedly to see the
 * refresh cadence; each run appends its evidence to scripts/spikes/out/.
 *
 *   pnpm spike ../../scripts/spikes/s4-reporting-lag.ts [captureId]
 */
import { save, sdk, step } from './lib.js';

const captureId = process.argv[2] ?? '34782754WR027910H';
const iso = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, 'Z');
const now = new Date();
const start = new Date(now.getTime() - 3 * 86_400_000);

const balances = await step('transactionSearch.searchBalances USD', () =>
  sdk.transactionSearch.searchBalances({ currencyCode: 'USD' }),
);
const found = await step(`transactionSearch.searchTransactions for ${captureId}`, () =>
  sdk.transactionSearch.searchTransactions({
    startDate: iso(start),
    endDate: iso(now),
    transactionId: captureId,
  }),
);
const recent = await step('transactionSearch.searchTransactions, last 3 days', () =>
  sdk.transactionSearch.searchTransactions({ startDate: iso(start), endDate: iso(now) }),
);

const refreshed = found.lastRefreshedDatetime ?? null;
const lagMinutes =
  refreshed === null ? null : Math.round((now.getTime() - new Date(refreshed).getTime()) / 60_000);
const result = {
  ranAt: iso(now),
  lastRefreshed: refreshed,
  lagMinutes,
  balance: balances.balances?.[0]?.availableBalance?.value ?? null,
  balanceAsOf: balances.asOfTime ?? null,
  captureVisible: (found.transactionDetails?.length ?? 0) > 0,
  transactionsLast3Days: recent.transactionDetails?.length ?? 0,
};
console.log(JSON.stringify(result, null, 2));
console.log(`Evidence: ${save(`s4-${Date.now().toString()}`, result)}`);
