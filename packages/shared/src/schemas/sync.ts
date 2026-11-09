import { z } from 'zod';
import { BalanceSource, PayPalEnvironment } from '../enums.js';
import { Currency, IsoDateTime, Money } from './common.js';

export const BalanceView = z.object({
  available: Money,
  currency: Currency,
  source: BalanceSource,
  asOf: IsoDateTime,
});
export type BalanceView = z.infer<typeof BalanceView>;

/** GET /api/connection — the Connect & import screen. Owner only. */
export const ConnectionResponse = z.object({
  paypal: z.object({
    environment: PayPalEnvironment,
    /** Credentials are present and an access token was obtained. */
    connected: z.boolean(),
    merchantId: z.string().nullable(),
    accountEmail: z.string().nullable(),
  }),
  lastSyncedAt: IsoDateTime.nullable(),
  counts: z.object({
    openInvoices: z.number().int().nonnegative(),
    allInvoices: z.number().int().nonnegative(),
    transactions: z.number().int().nonnegative(),
  }),
  balance: BalanceView.nullable(),
  demo: z.boolean(),
});
export type ConnectionResponse = z.infer<typeof ConnectionResponse>;

/** POST /api/sync — no body. Owner only. */
export const SyncRequest = z.strictObject({});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncResponse = z.object({
  syncedAt: IsoDateTime,
  invoices: z.object({
    imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  transactions: z.object({
    imported: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** Transaction Search can lag in sandbox; the window actually covered. */
    coveredFrom: IsoDateTime.nullable(),
    coveredTo: IsoDateTime.nullable(),
  }),
  balance: BalanceView,
});
export type SyncResponse = z.infer<typeof SyncResponse>;
