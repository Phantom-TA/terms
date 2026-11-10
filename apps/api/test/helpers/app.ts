/** Builds the real app on the test database, with PayPal faked at the transport (fetch) level. */
import { loadConfig } from '../../src/config.js';
import { type Db } from '../../src/db.js';
import { createApp, type AppOptions } from '../../src/http/app.js';
import { createLogger } from '../../src/logger.js';
import { buildServices, type ServiceOverrides, type Services } from '../../src/services.js';
import { testDatabaseUrl } from './db.js';
import { testPayPalConfig } from './fake-fetch.js';

export interface TestAppOptions extends ServiceOverrides, AppOptions {
  /** Leave PayPal unconfigured, as a fresh checkout without credentials would be. */
  noPayPal?: boolean;
}

export function testApp(db: Db, options: TestAppOptions = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    LOG_LEVEL: 'silent',
    APP_BASE_URL: 'https://terms.test',
    ...(options.noPayPal === true
      ? {}
      : {
          PAYPAL_CLIENT_ID: testPayPalConfig.clientId ?? '',
          PAYPAL_CLIENT_SECRET: testPayPalConfig.clientSecret ?? '',
          PAYPAL_WEBHOOK_ID: testPayPalConfig.webhookId ?? '',
        }),
  });
  const services: Services = buildServices(config, db, createLogger('silent'), options);
  // The test db client is shared with the test; the services use it too.
  return { app: createApp(services, options), services };
}
