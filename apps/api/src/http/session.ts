/**
 * Demo sessions (D-008): a visitor acts as one business. The browser holds a random token in an
 * httpOnly cookie; the database holds only its SHA-256 hash, so a database leak exposes no session.
 */
import { createHash, randomBytes } from 'node:crypto';
import { type Db } from '../db.js';
import { notFound } from '../errors.js';
import { type Business, type Session } from '../generated/prisma/client.js';

export const SESSION_COOKIE = 'terms_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionWithBusiness = Session & { business: Business };

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(businessId: string): Promise<{ token: string; session: SessionWithBusiness }> {
    const business = await this.db.business.findUnique({ where: { id: businessId } });
    if (business === null) throw notFound('Business');
    const token = randomBytes(32).toString('base64url');
    const session = await this.db.session.create({
      data: {
        businessId,
        tokenHash: hash(token),
        expiresAt: new Date(this.now().getTime() + SESSION_TTL_MS),
      },
      include: { business: true },
    });
    return { token, session };
  }

  /** The live session for a token, or null when unknown or expired. */
  async resolve(token: string | undefined): Promise<SessionWithBusiness | null> {
    if (token === undefined || token.length === 0 || token.length > 100) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: hash(token) },
      include: { business: true },
    });
    if (session === null || session.expiresAt.getTime() <= this.now().getTime()) return null;
    return session;
  }

  async destroy(sessionId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id: sessionId } });
  }
}

/** Reads one cookie from a Cookie header without a parser dependency. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function sessionCookie(token: string, expires: Date, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie('', new Date(0), secure);
}
