import 'dotenv/config';
import { createDb, type Db } from '../../src/db.js';

export function testDatabaseUrl(): string {
  return process.env['TEST_DATABASE_URL'] ?? 'postgresql://terms:terms@localhost:5432/terms_test';
}

export function createTestDb(): Db {
  return createDb(testDatabaseUrl());
}

/** Empties every table (keeps the schema). Call in beforeEach for isolation. */
export async function resetDb(db: Db): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
