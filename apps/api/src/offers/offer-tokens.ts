/**
 * Offer links for clients without an agent (CONTEXT.md: the public offer page). A token is
 * `base64url(dealId.expirySeconds).HMAC-SHA256`, signed with OFFER_TOKEN_SECRET; the deal stores
 * only the token's SHA-256 hash, so a database leak exposes no link. A token is valid while its
 * signature matches, it has not expired, and it is the deal's current token.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { type DbOrTx } from '../db.js';
import { AppError } from '../errors.js';
import { type Deal } from '../generated/prisma/client.js';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

export class OfferTokens {
  constructor(
    private readonly secret: string,
    private readonly appBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** Issues the deal's link (replacing any earlier one) and returns its URL. */
  async issue(
    db: DbOrTx,
    dealId: string,
    expiresAt: Date,
  ): Promise<{ token: string; url: string }> {
    const payload = `${dealId}.${String(Math.floor(expiresAt.getTime() / 1000))}`;
    const encoded = Buffer.from(payload).toString('base64url');
    const token = `${encoded}.${this.sign(encoded)}`;
    await db.deal.update({ where: { id: dealId }, data: { offerTokenHash: hash(token) } });
    return { token, url: `${this.appBaseUrl}/offer/${token}` };
  }

  /** The deal a token opens, or TOKEN_INVALID (410) when forged, expired or replaced. */
  async open(db: DbOrTx, token: string): Promise<Deal> {
    const invalid = () =>
      new AppError('TOKEN_INVALID', 'This offer link is invalid or has expired');
    const [encoded, signature, extra] = token.split('.');
    if (
      encoded === undefined ||
      signature === undefined ||
      extra !== undefined ||
      token.length > 300
    )
      throw invalid();
    const expected = Buffer.from(this.sign(encoded));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();
    const [dealId, exp] = Buffer.from(encoded, 'base64url').toString('utf8').split('.');
    if (dealId === undefined || exp === undefined || !/^\d+$/.test(exp)) throw invalid();
    if (Number(exp) * 1000 <= this.now().getTime()) throw invalid();
    const deal = await db.deal.findUnique({ where: { offerTokenHash: hash(token) } });
    if (deal?.id !== dealId) throw invalid();
    return deal;
  }
}
