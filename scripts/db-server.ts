import fs from "fs";
import path from "path";
import EmbeddedPostgres from "embedded-postgres";
import { loadEnv } from "./lib/load-env";

loadEnv();

/**
 * Local development database.
 *
 * This project does NOT require Docker: it spawns a real PostgreSQL cluster
 * from the `embedded-postgres` package into ./var/pgdata and keeps it alive
 * while this process runs. Production uses the PostgreSQL service described in
 * docs/deploy.md — never this script.
 *
 *   npm run db:server
 *
 * Databases created: afterkey (dev), afterkey_test (integration tests),
 * afterkey_e2e (end-to-end tests).
 */

const PORT = Number(process.env.PG_EMBEDDED_PORT ?? 5432);
const USER = process.env.PG_EMBEDDED_USER ?? "afterkey";
const PASSWORD = process.env.PG_EMBEDDED_PASSWORD ?? "afterkey";
const DATA_DIR = path.resolve(process.env.PG_EMBEDDED_DIR ?? "./var/pgdata");
const DATABASES = ["afterkey", "afterkey_test", "afterkey_e2e"];

function logLine(msg: string): void {
  process.stdout.write(`[db-server] ${msg}\n`);
}

async function ensureDatabases(pg: EmbeddedPostgres): Promise<void> {
  const client = pg.getPgClient("postgres");
  await client.connect();
  try {
    for (const name of DATABASES) {
      const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (!res.rowCount) {
        await client.query(`CREATE DATABASE "${name}"`);
        logLine(`created database ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const initialised = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: (m) => logLine(String(m).trim()),
    onError: (m) => process.stderr.write(`[db-server] ${String(m).trim()}\n`),
  });

  if (!initialised) {
    logLine(`initialising cluster at ${DATA_DIR} (first run takes a few seconds)…`);
    await pg.initialise();
  }

  try {
    await pg.start();
    logLine(`PostgreSQL listening on 127.0.0.1:${PORT}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/address already in use|EADDRINUSE/i.test(message)) {
      logLine(`port ${PORT} is already in use — assuming an existing cluster is running`);
    } else {
      throw err;
    }
  }

  await ensureDatabases(pg);
  logLine(`ready: ${DATABASES.join(", ")} (user=${USER})`);

  // Keep the process alive so the cluster stays up.
  const keepAlive = setInterval(() => undefined, 1 << 30);
  const shutdown = async () => {
    clearInterval(keepAlive);
    logLine("stopping cluster…");
    try {
      await pg.stop();
    } catch {
      /* already stopped */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[db-server] fatal: ${err instanceof Error ? err.stack ?? err.message : err}\n`);
  process.exit(1);
});
