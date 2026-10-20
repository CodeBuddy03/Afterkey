import { handleRoute, ok } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { queueStats, workerHeartbeat } from "@/lib/jobs/queue";
import { env } from "@/lib/env";

/**
 * Admin system diagnostics: job queue health, worker heartbeat, applied
 * migrations, controlled-clock offset (test environments only) and the
 * storage driver in use. Values here are operational metadata, never secrets.
 */

/** GET /api/admin/system */
export const GET = handleRoute(async () => {
  await requireAdmin();

  const [queue, heartbeat] = await Promise.all([queueStats(), workerHeartbeat()]);

  const migrations = await db
    .q<{ version: string; appliedAt: Date }>(`SELECT version, applied_at FROM schema_migrations ORDER BY version`)
    .catch(() => [] as Array<{ version: string; appliedAt: Date }>);

  let clockOffsetMs: number | null = null;
  try {
    const row = await db.q1<{ value: { ms?: number } | null }>(
      `SELECT value FROM system_settings WHERE key = 'test_clock_offset_ms'`,
    );
    clockOffsetMs = row?.value?.ms ?? 0;
  } catch {
    clockOffsetMs = null;
  }

  const deadJobs = await db.q<{ type: string; count: number }>(
    `SELECT type, count(*)::int AS count FROM jobs WHERE status = 'dead' GROUP BY type ORDER BY count DESC`,
  );

  const cfg = env();
  return ok({
    queue,
    heartbeat,
    deadJobs,
    migrations,
    clockOffsetMs,
    storage: {
      driver: cfg.STORAGE_DRIVER,
      bucket: cfg.S3_BUCKET ?? null,
      region: cfg.S3_REGION ?? null,
    },
    email: {
      provider: cfg.EMAIL_PROVIDER,
      from: cfg.EMAIL_FROM ?? null,
    },
    release: {
      defaultDelaySeconds: cfg.RELEASE_DELAY_SECONDS,
    },
    nodeEnv: cfg.NODE_ENV,
    testRoutesEnabled: cfg.AFTERKEY_ENABLE_TEST_ROUTES,
  });
});

export const runtime = "nodejs";
