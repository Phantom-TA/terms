import { endpoints, type EndpointDef, type EndpointName } from '@terms/shared';
import { type z } from 'zod';
import { ApiError, apiErrorFromResponse } from './errors';

type Endpoints = typeof endpoints;

/** Names of the `:param` segments in a route pattern. */
type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

type ParamsOption<N extends EndpointName> = [ParamNames<Endpoints[N]['path']>] extends [never]
  ? unknown
  : { params: Record<ParamNames<Endpoints[N]['path']>, string> };

type BodyOption<N extends EndpointName> = Endpoints[N] extends { body: infer S extends z.ZodType }
  ? { body: z.input<S> }
  : unknown;

type QueryOption<N extends EndpointName> = Endpoints[N] extends { query: infer S extends z.ZodType }
  ? { query?: z.input<S> }
  : unknown;

export type ApiRequestOptions<N extends EndpointName> = ParamsOption<N> &
  BodyOption<N> &
  QueryOption<N> & { signal?: AbortSignal };

export type ApiResponse<N extends EndpointName> = Endpoints[N] extends {
  response: infer S extends z.ZodType;
}
  ? z.output<S>
  : undefined;

type ApiArgs<N extends EndpointName> =
  Record<string, never> extends ApiRequestOptions<N>
    ? [options?: ApiRequestOptions<N>]
    : [options: ApiRequestOptions<N>];

interface LooseOptions {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

function buildUrl(def: EndpointDef, options: LooseOptions): string {
  const path = def.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = options.params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${def.path}`);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The only way the app talks to the API. Paths, bodies, queries and responses are typed from the
 * shared route table, and every response is validated against its schema before the UI sees it.
 */
export async function api<N extends EndpointName>(
  name: N,
  ...args: ApiArgs<N>
): Promise<ApiResponse<N>> {
  const def: EndpointDef = endpoints[name];
  const options = (args[0] ?? {}) as LooseOptions;

  let requestBody: string | undefined;
  if (def.body) {
    const parsed = def.body.safeParse(options.body);
    if (!parsed.success) {
      throw new ApiError({
        kind: 'contract',
        message: `This request is not valid: ${parsed.error.issues[0]?.message ?? 'unknown field'}.`,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    requestBody = JSON.stringify(parsed.data);
  }

  const init: RequestInit = {
    method: def.method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(requestBody === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  };
  if (requestBody !== undefined) init.body = requestBody;
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(buildUrl(def, options), init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      kind: 'network',
      message: 'Could not reach the Terms server. Check your connection and try again.',
      retryable: true,
    });
  }

  if (!response.ok) throw apiErrorFromResponse(response.status, await readJson(response));
  if (def.response === null || response.status === 204) return undefined as ApiResponse<N>;

  const json = await readJson(response);
  const parsed = def.response.safeParse(json);
  if (!parsed.success) {
    console.error(`Response from ${def.method} ${def.path} did not match its schema`, parsed.error);
    throw new ApiError({
      kind: 'contract',
      status: response.status,
      message: 'The server sent data this version of Terms cannot read, so nothing was changed.',
    });
  }
  return parsed.data as ApiResponse<N>;
}
