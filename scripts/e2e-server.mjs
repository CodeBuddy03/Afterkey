/**
 * E2E web server (used by playwright.config.ts webServer).
 *
 * Boots `next dev` against the disposable afterkey_e2e database:
 *   1. loads .env.local (existing process env always wins)
 *   2. repoints DATABASE_URL at afterkey_e2e and APP_URL at the e2e origin
 *   3. applies migrations (idempotent)
 *   4. resets e2e data so every run starts deterministic — including the
 *      durable rate-limit buckets (register allows only 5/hour/IP and the
 *      limiter is database-backed, so stale buckets would break repeat runs)
 *   5. starts Next and forwards signals / exit code to Playwright
 *
 * The development database (afterkey) is never touched.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.E2E_PORT ?? "3100";

function loadEnv(cwd = process.cwd()) {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = fs.readFileSync(path.join(cwd, file), "utf8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        if (key in process.env) continue;
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      /* file absent */
    }
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

const dbUrl = new URL(process.env.DATABASE_URL);
dbUrl.pathname = "/afterkey_e2e";
process.env.DATABASE_URL = dbUrl.toString();
process.env.APP_URL = `http://127.0.0.1:${PORT}`;

const env = { ...process.env };

// Build-time environment: `next build` prerenders with production boot guards
// active, so the build must pass them — with throwaway random secrets (this is
// a disposable local e2e instance, never deployed) and no test routes.
const { randomBytes } = await import("node:crypto");
const buildEnv = { ...env };
// Explicit "" (falsy) beats .env.local, which Next loads itself for any key
// not present in the real environment.
buildEnv.AFTERKEY_ENABLE_TEST_ROUTES = "";
Object.assign(buildEnv, {
  NODE_ENV: "production",
  AFTERKEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  AFTERKEY_APP_SECRET: randomBytes(32).toString("hex"),
  EMAIL_PROVIDER: "smtp",
  SMTP_URL: "smtp://127.0.0.1:1025",
  ALLOW_UNSCANNED_UPLOADS: "true",
});

// Runtime environment: the suite needs /api/test/* routes (mailbox, clock,
// tick), which env.ts only honors outside production — so the server runs in
// development mode against the production build.
const runEnv = { ...env, NODE_ENV: "development", AFTERKEY_ENABLE_TEST_ROUTES: "true" };

// 1) Migrations (idempotent; checksum-guarded).
const migrate = spawnSync("tsx", ["scripts/migrate.ts", "--database=afterkey_e2e"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});
if (migrate.status !== 0) {
  console.error("e2e: migrations failed");
  process.exit(migrate.status ?? 1);
}

// 2) Reset e2e data. Keeps migration bookkeeping and FK reference data (plans).
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10_000 });
await client.connect();
try {
  const res = await client.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'plans')`,
  );
  if (res.rowCount > 0) {
    const list = res.rows.map((r) => `"${r.tablename}"`).join(", ");
    await client.query(`TRUNCATE ${list} CASCADE`);
    console.log(`e2e: reset afterkey_e2e (${res.rowCount} tables)`);
  }
} finally {
  await client.end();
}

// 3) Production build. Next dev serializes on-demand compiles, so runtime
// requests queue behind chunk builds (logout once took 40s mid-test). A
// real build makes every response deterministic and fast.
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const build = spawnSync(process.execPath, [nextBin, "build"], { stdio: "inherit", env: buildEnv });
if (build.status !== 0) {
  console.error("e2e: next build failed");
  process.exit(build.status ?? 1);
}

// 4) Serve the built app.
const child = spawn(process.execPath, [nextBin, "start", "-p", PORT], { stdio: "inherit", env: runEnv });

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code) => process.exit(code ?? 0));
