/**
 * Server configuration from environment variables, validated once at startup. Optional
 * integrations (PayPal, LLM) may be missing: features that need them answer NOT_CONFIGURED
 * instead of failing at boot, so the rest of the app (and its tests) still run.
 */
import { z } from 'zod';

const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v);
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  PAYPAL_CLIENT_ID: optionalSecret,
  PAYPAL_CLIENT_SECRET: optionalSecret,
  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_WEBHOOK_ID: optionalSecret,

  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'google']).default('anthropic'),
  LLM_API_KEY: optionalSecret,
  LLM_MODEL: z.string().min(1).default('claude-sonnet-5-5'),
  LLM_MODEL_FAST: z.string().min(1).default('claude-haiku-5-5'),

  SESSION_SECRET: optionalSecret,
  OFFER_TOKEN_SECRET: optionalSecret,
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  appBaseUrl: string;
  databaseUrl: string;
  logLevel: string;
  paypal: {
    environment: 'sandbox' | 'live';
    clientId: string | null;
    clientSecret: string | null;
    webhookId: string | null;
    configured: boolean;
    baseUrl: string;
  };
  llm: {
    provider: 'anthropic' | 'openai' | 'google';
    apiKey: string | null;
    model: string;
    fastModel: string;
    configured: boolean;
  };
  sessionSecret: string;
  offerTokenSecret: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEV_ONLY_SECRET = 'dev-only-insecure-secret-change-me-0000000000';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  for (const name of ['SESSION_SECRET', 'OFFER_TOKEN_SECRET'] as const) {
    const value = e[name];
    if (production && (value === undefined || value.length < 32)) {
      throw new ConfigError(`${name} must be set to at least 32 characters in production`);
    }
  }

  const clientId = e.PAYPAL_CLIENT_ID ?? null;
  const clientSecret = e.PAYPAL_CLIENT_SECRET ?? null;
  const apiKey = e.LLM_API_KEY ?? null;

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    appBaseUrl: e.APP_BASE_URL.replace(/\/$/, ''),
    databaseUrl: e.DATABASE_URL,
    logLevel: e.LOG_LEVEL,
    paypal: {
      environment: e.PAYPAL_ENV,
      clientId,
      clientSecret,
      webhookId: e.PAYPAL_WEBHOOK_ID ?? null,
      configured: clientId !== null && clientSecret !== null,
      baseUrl:
        e.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    },
    llm: {
      provider: e.LLM_PROVIDER,
      apiKey,
      model: e.LLM_MODEL,
      fastModel: e.LLM_MODEL_FAST,
      configured: apiKey !== null,
    },
    sessionSecret: e.SESSION_SECRET ?? DEV_ONLY_SECRET,
    offerTokenSecret: e.OFFER_TOKEN_SECRET ?? DEV_ONLY_SECRET,
  };
}
