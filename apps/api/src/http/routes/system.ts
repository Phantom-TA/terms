/** Health, the businesses a demo visitor can act as, and demo sessions. */
import { endpoints } from '@terms/shared';
import { type Router } from 'express';
import { type Services } from '../../services.js';
import { API_VERSION } from '../../version.js';
import { route } from '../route.js';
import { clearedSessionCookie, sessionCookie, type SessionWithBusiness } from '../session.js';
import { businessSummary } from '../views.js';

export function registerSystemRoutes(router: Router, s: Services): void {
  const secure = s.config.env === 'production';
  const sessionView = (session: SessionWithBusiness) => ({
    business: businessSummary(session.business),
    paypalEnvironment: s.config.paypal.environment,
    demo: session.business.isDemo,
    expiresAt: session.expiresAt.toISOString(),
  });

  route(router, s.sessions, endpoints.health, async () => {
    let database: 'ok' | 'down' = 'ok';
    try {
      await s.db.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return {
      status: database === 'ok' ? ('ok' as const) : ('degraded' as const),
      version: API_VERSION,
      database,
      paypalEnvironment: s.config.paypal.environment,
      paypalConfigured: s.config.paypal.configured,
      aiConfigured: s.config.llm.configured,
      time: s.now().toISOString(),
    };
  });

  route(router, s.sessions, endpoints.listBusinesses, async () => {
    const businesses = await s.db.business.findMany({
      // Enum order puts SUPPLIER before CLIENT.
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return { businesses: businesses.map(businessSummary) };
  });

  route(router, s.sessions, endpoints.getSession, ({ session }) =>
    Promise.resolve(sessionView(session)),
  );

  route(router, s.sessions, endpoints.createSession, async ({ body, res }) => {
    const { token, session } = await s.sessions.create(body.businessId);
    res.setHeader('Set-Cookie', sessionCookie(token, session.expiresAt, secure));
    await s.audit.write(s.db, {
      actor: session.business.role === 'SUPPLIER' ? 'OWNER' : 'CLIENT_HUMAN',
      action: 'SESSION_STARTED',
      subjectType: 'SESSION',
      subjectId: session.id,
      businessIds: [session.businessId],
      summary: `Demo session started as ${session.business.name}`,
    });
    return sessionView(session);
  });

  route(router, s.sessions, endpoints.deleteSession, async ({ session, res }) => {
    await s.sessions.destroy(session.id);
    res.setHeader('Set-Cookie', clearedSessionCookie(secure));
    return undefined;
  });
}
