import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type Db = PrismaClient;
/** A Prisma client or an interactive-transaction client. */
export type DbTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
export type DbOrTx = Db | DbTx;

export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
