/**
 * Applies all migrations to the integration-test database before any test file runs.
 * Uses TEST_DATABASE_URL (local: `pnpm db:local` or `pnpm db:up`; CI: the Postgres service).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

export default function setup(): void {
  const url =
    process.env['TEST_DATABASE_URL'] ?? 'postgresql://terms:terms@localhost:5432/terms_test';
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const require = createRequire(path.join(root, 'package.json'));
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
