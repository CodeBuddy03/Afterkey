import { loadEnv } from "./lib/load-env";

loadEnv();

/**
 * Create the sibling test databases (afterkey_test, afterkey_e2e) when they
 * do not exist, then apply migrations to each. Safe to re-run: databases are
 * only created if missing and migrations are idempotent.
 *
 *   npm run db:setup-test
 *
 * Test data is disposable — integration tests truncate between cases and the
 * e2e suite owns afterkey_e2e exclusively.
 */

const TARGETS = ["afterkey_test", "afterkey_e2e"];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  const { default: pg } = await import("pg");
  // Connect to the maintenance database so CREATE DATABASE is allowed even
  // when the target database does not exist yet.
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 10_000 });
  await admin.connect();

  try {
    for (const name of TARGETS) {
      const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (exists.rowCount) {
        console.log(`exists  ${name}`);
      } else {
        // Identifier cannot be parameterized; validated against the same rule
        // migrate.ts enforces before it ever interpolates a name.
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid database name: ${name}`);
        await admin.query(`CREATE DATABASE ${name}`);
        console.log(`created ${name}`);
      }
    }
  } finally {
    await admin.end();
  }

  const { spawnSync } = await import("child_process");
  for (const name of TARGETS) {
    const res = spawnSync("tsx", ["scripts/migrate.ts", `--database=${name}`], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      console.error(`Migration failed for ${name}.`);
      process.exit(res.status ?? 1);
    }
  }

  console.log("Test databases ready.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
