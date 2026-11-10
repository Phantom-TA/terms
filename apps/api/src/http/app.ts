/**
 * The Express app: request ids, body parsing (raw for PayPal webhooks, so the signature can be
 * checked over the exact bytes), the routes from the shared endpoint table, the built web app for
 * every other path, and one error handler that answers with the shared ApiErrorBody.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { IllegalTransitionError, paths } from '@terms/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import { type Services } from '../services.js';
import { registerRoutes } from './routes/index.js';
import { ContractError } from './route.js';

/** Request ids, kept beside the request rather than on it. */
const requestIds = new WeakMap<Request, string>();
export const requestIdOf = (req: Request): string | undefined => requestIds.get(req);

export interface AppOptions {
  /** Directory of the built web app (apps/web/dist); served for every non-API path when present. */
  webDist?: string | null;
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', 'The request is not valid', {
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof IllegalTransitionError) return new AppError('CONFLICT', err.message);
  // body-parser: malformed JSON or a body over the limit.
  if (typeof err === 'object' && err !== null && 'type' in err) {
    const type = err.type;
    if (type === 'entity.parse.failed') return new AppError('VALIDATION_FAILED', 'Malformed JSON');
    if (type === 'entity.too.large')
      return new AppError('VALIDATION_FAILED', 'Request body too large');
  }
  return new AppError('INTERNAL', 'Something went wrong', { cause: err });
}

/** The one error handler: every failure becomes the shared ApiErrorBody. */
export function errorHandler(services: Services) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const appError = toAppError(err);
    if (appError.code === 'INTERNAL') {
      services.logger.error(
        {
          err: err instanceof ContractError ? { message: err.message, issues: err.issues } : err,
          requestId: requestIdOf(req),
        },
        'request failed',
      );
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(appError.status).json(appError.toBody(requestIdOf(req)));
  };
}

export function createApp(services: Services, options: AppOptions = {}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS in front of the app

  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    requestIds.set(req, id);
    res.setHeader('X-Request-Id', id);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.use(paths.paypalWebhook(), express.raw({ type: () => true, limit: '1mb' }));
  app.use('/api', express.json({ limit: '100kb' }));

  const api = express.Router();
  registerRoutes(api, services);
  app.use(api);
  app.use('/api', (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError('NOT_FOUND', 'No such API route'));
  });

  const dist = options.webDist ?? null;
  if (dist !== null && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // The SPA owns every other path, including /offer/:token (D-007).
    app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
      res.sendFile('index.html', { root: dist, maxAge: 0 });
    });
  }

  app.use(errorHandler(services));

  return app;
}
