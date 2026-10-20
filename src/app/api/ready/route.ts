import { ok } from "@/lib/api/http";
import { pingDatabase, db } from "@/lib/db";
import { storageStatus } from "@/lib/storage/storage";
import { emailProviderStatus } from "@/lib/email/provider";
import { queueStats, workerHeartbeat } from "@/lib/jobs/queue";
import { env } from "@/lib/env";
import fs from "fs";
import path from "path";

/**
 * Readiness: reports dependency status with no secrets.
 * 503 when a critical dependency (database, migrations) is down.
 */
export const GET = async (): Promise<Response> => {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  const dbPing = await pingDatabase();
  checks.database = { ok: dbPing.ok, detail: dbPing.ok ? "connected" : (dbPing.error ?? "unreachable") };

  if (dbPing.ok) {
    try {
      const applied = await db.q<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`);
      const dir = path.join(process.cwd(), "migrations");
      const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
      const pending = onDisk.filter((f) => !applied.some((a) => a.version === f));
      checks.migrations = {
        ok: pending.length === 0,
        detail: pending.length === 0 ? `${applied.length} applied` : `pending: ${pending.join(", ")}`,
      };
    } catch {
      checks.migrations = { ok: false, detail: "schema_migrations table missing" };
    }
  } else {
    checks.migrations = { ok: false, detail: "database unavailable" };
  }

  try {
    const storage = await storageStatus();
    checks.storage = { ok: storage.ok, detail: `${storage.driver}: ${storage.detail}` };
  } catch (err) {
    checks.storage = { ok: false, detail: err instanceof Error ? err.message : "storage error" };
  }

  try {
    const email = await emailProviderStatus();
    checks.email = {
      ok: email.configured,
      detail: email.hint ?? `${email.provider}: ${email.sending ? "sending" : "not sending"}`,
    };
  } catch {
    checks.email = { ok: false, detail: "email provider error" };
  }

  try {
    const hb = await workerHeartbeat();
    checks.worker = {
      ok: hb.fresh,
      detail: hb.at ? `last heartbeat ${new Date(hb.at).toISOString()} (${hb.worker ?? "unknown"})` : "no heartbeat yet",
    };
  } catch {
    checks.worker = { ok: false, detail: "heartbeat unavailable" };
  }

  try {
    const stats = await queueStats();
    const lagOk = stats.dead === 0 && (stats.oldestQueuedAgeSeconds ?? 0) < 3600;
    checks.jobs = {
      ok: lagOk,
      detail: `queued=${stats.queued} scheduled=${stats.scheduled} running=${stats.running} dead=${stats.dead} overdue=${stats.oldestQueuedAgeSeconds === null ? "none" : `${stats.oldestQueuedAgeSeconds}s`}`,
    };
  } catch {
    checks.jobs = { ok: false, detail: "queue unavailable" };
  }

  const environment = {
    nodeEnv: env().NODE_ENV,
    testRoutesEnabled: env().AFTERKEY_ENABLE_TEST_ROUTES,
    storageDriver: env().STORAGE_DRIVER,
    emailProvider: env().EMAIL_PROVIDER,
  };

  const criticalOk = checks.database.ok && checks.migrations.ok;
  const body = { status: criticalOk ? "ready" : "not_ready", checks, environment };
  if (criticalOk) return ok(body);
  return Response.json({ error: { code: "not_ready", message: "Service is not ready." }, data: body }, { status: 503 });
};

export const dynamic = "force-dynamic";
