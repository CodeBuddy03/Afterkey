import { afterAll, beforeAll } from "vitest";
import { loadEnv } from "../../scripts/lib/load-env";

/**
 * Integration suite environment.
 *
 * Runs before each test file's imports: loads .env.local, then repoints
 * DATABASE_URL at the disposable afterkey_test database so no test can touch
 * development or production data. Each file starts from a truncated database.
 */
loadEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first, then run: npm run db:setup-test");
}

const testDbUrl = new URL(process.env.DATABASE_URL);
testDbUrl.pathname = "/afterkey_test";
process.env.DATABASE_URL = testDbUrl.toString();
Object.assign(process.env, { NODE_ENV: "test" }); // NODE_ENV is typed read-only

// Imported after the env override (env is read lazily, but keep the order explicit).
const { db, getPool } = await import("@/lib/db");

beforeAll(async () => {
  // Preserve bookkeeping (schema_migrations) and FK reference data seeded by
  // migrations (plans) — truncating those breaks registration foreign keys.
  const tables = await db.q<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN ('schema_migrations', 'plans')`,
  );
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.tablename}"`).join(", ");
    await db.raw(`TRUNCATE ${list} CASCADE`);
  }
});

afterAll(async () => {
  await getPool().end();
});
