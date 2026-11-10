/**
 * Registers handlers from the shared endpoint table (`endpoints` in @terms/shared), so the API
 * serves exactly the contract the web app is built against:
 *  - the session is resolved and the endpoint's `auth` enforced before the handler runs;
 *  - query and body are parsed with the endpoint's schemas (a failure is VALIDATION_FAILED);
 *  - the handler's result is checked against the endpoint's response schema before it is sent,
 *    so the API cannot drift from the contract unnoticed.
 */
import { type EndpointDef } from '@terms/shared';
import { type NextFunction, type Request, type Response, type Router } from 'express';
import { type z } from 'zod';
import { AppError, forbidden } from '../errors.js';
import {
  readCookie,
  SESSION_COOKIE,
  type SessionService,
  type SessionWithBusiness,
} from './session.js';

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;

/** Session routes always have a session; the others never read one. */
type SessionFor<E extends EndpointDef> = E['auth'] extends 'OWNER' | 'CLIENT' | 'SESSION'
  ? SessionWithBusiness
  : null;

export interface HandlerInput<E extends EndpointDef> {
  params: Record<string, string>;
  query: Infer<E['query']>;
  body: Infer<E['body']>;
  session: SessionFor<E>;
  req: Request;
  res: Response;
}

/** What a handler returns: the response body, or nothing for 204 and streamed routes. */
export type HandlerResult<E extends EndpointDef> = E['response'] extends z.ZodType
  ? z.input<E['response']>
  : undefined;

export type Handler<E extends EndpointDef> = (input: HandlerInput<E>) => Promise<HandlerResult<E>>;

export class ContractError extends Error {
  constructor(
    readonly endpoint: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Response for ${endpoint} does not match its contract`);
    this.name = 'ContractError';
  }
}

function needsSession(auth: EndpointDef['auth']): boolean {
  return auth === 'OWNER' || auth === 'CLIENT' || auth === 'SESSION';
}

/** Owner routes need the supplier; client routes need a client business. */
export function assertRole(auth: EndpointDef['auth'], session: SessionWithBusiness | null): void {
  if (!needsSession(auth)) return;
  if (session === null) throw new AppError('UNAUTHENTICATED', 'Start a session first');
  if (auth === 'OWNER' && session.business.role !== 'SUPPLIER') {
    throw forbidden('Only the supplier can use this');
  }
  if (auth === 'CLIENT' && session.business.role !== 'CLIENT') {
    throw forbidden('Only a client business can use this');
  }
}

export function route<const E extends EndpointDef>(
  router: Router,
  sessions: SessionService,
  endpoint: E,
  handler: Handler<E>,
): void {
  const method = endpoint.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  router[method](endpoint.path, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = needsSession(endpoint.auth)
        ? await sessions.resolve(readCookie(req.headers.cookie, SESSION_COOKIE))
        : null;
      assertRole(endpoint.auth, session);
      const query = endpoint.query === undefined ? undefined : endpoint.query.parse(req.query);
      // PayPal webhooks keep their raw body for signature verification.
      const body =
        endpoint.body === undefined || endpoint.auth === 'PAYPAL'
          ? undefined
          : endpoint.body.parse(req.body ?? {});
      const result = await handler({
        params: req.params as Record<string, string>,
        query: query as Infer<E['query']>,
        body: body as Infer<E['body']>,
        session: session as SessionFor<E>,
        req,
        res,
      });
      if (res.headersSent) return; // streamed
      if (endpoint.status === 204 || endpoint.response === null) {
        res.status(endpoint.status).end();
        return;
      }
      const checked = endpoint.response.safeParse(result);
      if (!checked.success)
        throw new ContractError(`${endpoint.method} ${endpoint.path}`, checked.error.issues);
      res.status(endpoint.status).json(checked.data);
    } catch (err) {
      next(err);
    }
  });
}
