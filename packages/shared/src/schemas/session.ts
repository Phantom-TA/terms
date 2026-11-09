import { z } from 'zod';
import { BusinessRole, PayPalEnvironment } from '../enums.js';
import { Id, IsoDateTime } from './common.js';

/** A business known to Terms: the supplier (owner) or one of its clients. */
export const BusinessSummary = z.object({
  id: Id,
  name: z.string(),
  /** URL-safe handle used in negotiation party refs, e.g. "harbor-co". */
  slug: z.string(),
  role: BusinessRole,
  hasAgent: z.boolean(),
  /** Sandbox account email; shown on the demo picker so judges can log in to PayPal. */
  paypalEmail: z.string().nullable(),
  /** True for businesses created by the demo seed script. */
  isDemo: z.boolean(),
});
export type BusinessSummary = z.infer<typeof BusinessSummary>;

/** GET /api/businesses — the businesses a demo visitor can act as. Public. */
export const ListBusinessesResponse = z.object({
  businesses: z.array(BusinessSummary),
});
export type ListBusinessesResponse = z.infer<typeof ListBusinessesResponse>;

/** POST /api/session — start a demo session as one business (sets an httpOnly cookie). */
export const CreateSessionRequest = z.strictObject({
  businessId: Id,
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

/** GET/POST /api/session response. */
export const SessionResponse = z.object({
  business: BusinessSummary,
  paypalEnvironment: PayPalEnvironment,
  /** True when the app runs on seeded demo data; the UI shows a "Demo data" label. */
  demo: z.boolean(),
  expiresAt: IsoDateTime,
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** GET /api/health. Public. */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  database: z.enum(['ok', 'down']),
  paypalEnvironment: PayPalEnvironment,
  paypalConfigured: z.boolean(),
  aiConfigured: z.boolean(),
  time: IsoDateTime,
});
export type HealthResponse = z.infer<typeof HealthResponse>;
