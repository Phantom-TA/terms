/**
 * A fixed-window, per-client-IP limiter for public routes (CONTEXT.md, security: rate-limit the
 * public demo). In memory: one API instance serves the demo.
 */
import { type NextFunction, type Request, type Response } from 'express';
import { AppError } from '../errors.js';

export function rateLimit(options: { windowMs: number; max: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? 'unknown';
    const t = now();
    const entry = hits.get(key);
    if (entry === undefined || t - entry.start >= options.windowMs) {
      hits.set(key, { start: t, count: 1 });
      // Keep the map from growing without bound.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (t - v.start >= options.windowMs) hits.delete(k);
      }
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.start + options.windowMs - t) / 1000)));
      next(
        new AppError('RATE_LIMITED', 'Too many requests; try again shortly', { retryable: true }),
      );
      return;
    }
    next();
  };
}
