#!/usr/bin/env node
// Runs a real PostgreSQL 17 server from npm binaries (embedded-postgres), for machines where
// Docker is unavailable. Same credentials and databases as docker-compose.yml:
//   postgresql://terms:terms@localhost:5432/terms       (development)
//   postgresql://terms:terms@localhost:5432/terms_test  (integration tests)
// Data persists in .local/pg. Stop with Ctrl+C.
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.PGPORT ?? 5432);
const databaseDir = path.resolve('.local', 'pg');
const firstRun = !existsSync(path.join(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'terms',
  password: 'terms',
  port,
  persistent: true,
  onLog: () => undefined,
  onError: (message) => {
    console.error(String(message));
  },
});

if (firstRun) await pg.initialise();
await pg.start();

const client = pg.getPgClient();
await client.connect();
for (const db of ['terms', 'terms_test']) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (rowCount === 0) await pg.createDatabase(db);
}
await client.end();

console.log(
  `Postgres 17 running on localhost:${port} (databases: terms, terms_test). Ctrl+C to stop.`,
);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
