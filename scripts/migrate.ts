import fs from "fs";
import path from "path";
import crypto from "crypto";
import { loadEnv } from "./lib/load-env";

loadEnv();

/**
 * Runs SQL migrations in order inside transactions and records a checksum.
 * Never run migrations automatically from the web process in production —
 * deploy with `npm run db:migrate` as a controlled step (see docs/deploy.md).
 */

async function main(): Promise<void> {
  let url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
    process.exit(1);
  }

  // --database=<name> targets a sibling database on the same server.
  const dbFlag = process.argv.find((a) => a.startsWith("--database="));
  if (dbFlag) {
    const name = dbFlag.slice("--database=".length);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      console.error(`Invalid database name: ${name}`);
      process.exit(1);
    }
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    url = parsed.toString();
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(process.cwd(), "migrations");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const allowDrift = process.env.MIGRATE_ALLOW_DRIFT === "1";
    let applied = 0;

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex").slice(0, 32);
      const existing = await client.query("SELECT checksum FROM schema_migrations WHERE version = $1", [file]);

      if (existing.rowCount) {
        const prev = existing.rows[0].checksum as string;
        if (prev !== checksum && !allowDrift) {
          throw new Error(
            `Migration ${file} changed after it was applied (checksum mismatch).\n` +
              "Create a new migration instead of editing an applied one, or set MIGRATE_ALLOW_DRIFT=1 in development.",
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
        applied += 1;
        console.log(`applied  ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const state = await client.query("SELECT version FROM schema_migrations ORDER BY version");
    console.log(`\nMigrations up to date (${state.rowCount} total, ${applied} newly applied).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
