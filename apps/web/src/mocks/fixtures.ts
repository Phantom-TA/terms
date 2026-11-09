import { HealthResponse, ListBusinessesResponse, type SessionResponse } from '@terms/shared';

/** Marks mock data; scripts/check-prod-bundle.mjs fails the build if this string ever ships. */
export const TERMS_MOCK_FIXTURE = 'TERMS_MOCK_FIXTURE';

/** The demo cast from CONTEXT.md. Parsed with the shared schema so fixtures can't drift from it. */
export const businesses = ListBusinessesResponse.parse({
  businesses: [
    {
      id: 'biz_maya',
      name: 'Maya Studio',
      slug: 'maya-studio',
      role: 'SUPPLIER',
      hasAgent: true,
      paypalEmail: 'maya-studio@business.example.com',
      isDemo: true,
    },
    {
      id: 'biz_juniper',
      name: 'Juniper Labs',
      slug: 'juniper-labs',
      role: 'CLIENT',
      hasAgent: true,
      paypalEmail: 'juniper@business.example.com',
      isDemo: true,
    },
    {
      id: 'biz_harbor',
      name: 'Harbor & Co',
      slug: 'harbor-co',
      role: 'CLIENT',
      hasAgent: true,
      paypalEmail: 'harbor@business.example.com',
      isDemo: true,
    },
  ],
}).businesses;

export const health = HealthResponse.parse({
  status: 'ok',
  version: 'mock',
  database: 'ok',
  paypalEnvironment: 'sandbox',
  paypalConfigured: true,
  aiConfigured: true,
  time: '2026-11-09T10:00:00Z',
});

export function sessionFor(businessId: string): SessionResponse | null {
  const business = businesses.find((b) => b.id === businessId);
  if (!business) return null;
  return {
    business,
    paypalEnvironment: 'sandbox',
    demo: true,
    expiresAt: '2030-01-01T00:00:00Z',
  };
}
