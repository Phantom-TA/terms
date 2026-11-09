import { pino, type Logger } from 'pino';

/** Paths never written to logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.access_token',
  '*.client_secret',
  '*.clientSecret',
  '*.apiKey',
  '*.token',
  '*.password',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'terms-api' },
  });
}

export type { Logger };
