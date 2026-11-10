/**
 * Entry point: load configuration, build the services, serve the API (and the built web app when
 * apps/web/dist exists), and run the periodic jobs that keep deals honest over time.
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createApp } from './http/app.js';
import { createLogger } from './logger.js';
import { buildServices } from './services.js';

/** How often expired offers and approvals are closed. */
const HOUSEKEEPING_MS = 60_000;

const config = loadConfig();
const logger = createLogger(config.logLevel);
const db = createDb(config.databaseUrl);
const services = buildServices(config, db, logger);
// src/server.ts and dist/server.js both sit two levels below apps/.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = createApp(services, { webDist });

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      paypal: config.paypal.environment,
      paypalConfigured: config.paypal.configured,
    },
    'Terms API listening',
  );
});

const housekeeping = setInterval(() => {
  void (async () => {
    try {
      const offers = await services.engine.expireDue();
      const approvals = await services.approvals.expireDue();
      if (offers + approvals > 0) logger.info({ offers, approvals }, 'expired');
    } catch (err) {
      logger.error({ err }, 'housekeeping failed');
    }
  })();
}, HOUSEKEEPING_MS);

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  clearInterval(housekeeping);
  server.close(() => {
    void db.$disconnect().finally(() => process.exit(0));
  });
  // Open SSE streams would hold close() forever.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
