import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI configuration (schema, migrations, connection URL). The app itself connects through
// the pg driver adapter in apps/api/src/db.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://terms:terms@localhost:5432/terms',
  },
});
