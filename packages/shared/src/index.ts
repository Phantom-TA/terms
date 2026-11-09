/**
 * @terms/shared — the contract between the Terms API and web app.
 * The web app imports from here and never redefines these types.
 */
export * from './money.js';
export * from './dates.js';
export * from './rates.js';
export * from './enums.js';
export * from './deal-state.js';
export * from './policy.js';
export * from './routes.js';

export * from './schemas/common.js';
export * from './schemas/errors.js';
export * from './schemas/session.js';
export * from './schemas/sync.js';
export * from './schemas/negotiation.js';
export * from './schemas/approvals.js';
export * from './schemas/deals.js';
export * from './schemas/plans.js';
export * from './schemas/goals.js';
export * from './schemas/invoices.js';
export * from './schemas/runway.js';
export * from './schemas/policies.js';
export * from './schemas/client.js';
export * from './schemas/offer-page.js';
export * from './schemas/audit.js';
export * from './schemas/studio.js';
export * from './schemas/webhooks.js';
export * from './schemas/events.js';

/** Contract version; bumped with each contracts-vN tag. */
export const CONTRACTS_VERSION = 2;
