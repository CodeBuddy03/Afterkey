import { db, withTransaction, type Queryable, type Row } from "../db";
import { now } from "../clock";
import { log } from "../logger";

/**
 * Durable Postgres job queue.
 *
 * - Jobs live in the `jobs` table (survive restarts).
 * - Claiming uses FOR UPDATE SKIP LOCKED so multiple workers never double-run.
 * - idempotency_key is UNIQUE: scheduling the same logical job twice is a no-op.
 * - Failures retry with exponential backoff, then dead-letter.
 * - Stale 'running' jobs (crashed worker) are reclaimed automatically.
 */

export interface JobRow extends Row {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  runAt: Date;
  status: "queued" | "running" | "done" | "failed" | "canceled" | "dead";
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  lastError: string | null;
}

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  idempotencyKey?: string;
  maxAttempts?: number;
}

/** Enqueue a job. Returns null when an identical idempotency key already exists. */
export async function enqueue(input: EnqueueInput, exec: Queryable = db): Promise<number | null> {
  const row = await exec.q1<{ id: number }>(
    `INSERT INTO jobs (type, payload, run_at, idempotency_key, max_attempts)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.runAt ?? now(),
      input.idempotencyKey ?? null,
      input.maxAttempts ?? 8,
    ],
  );
  return row?.id ?? null;
}

const RETRY_BASE_SECONDS = 30;
const RETRY_MAX_SECONDS = 3600;
const STALE_RUNNING_MINUTES = 15;

export function backoffSeconds(attempts: number): number {
  return Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.max(0, attempts - 1));
}

/** Reclaim jobs whose worker died mid-run. */
export async function reclaimStaleJobs(): Promise<number> {
  const res = await db.raw(
    `UPDATE jobs
        SET status = 'queued', locked_by = NULL, locked_at = NULL,
            last_error = 'reclaimed after stale lock',
            run_at = now()
      WHERE status = 'running' AND locked_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_RUNNING_MINUTES)],
  );
  return res.rowCount ?? 0;
}

export async function claimDueJobs(workerId: string, limit: number): Promise<JobRow[]> {
  return withTransaction(async (tx) => {
    const rows = await tx.q<JobRow>(
      `WITH due AS (
         SELECT id FROM jobs
          WHERE status = 'queued' AND run_at <= $3
          ORDER BY run_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE jobs j
          SET status = 'running', locked_by = $2, locked_at = now(), attempts = j.attempts + 1, updated_at = now()
         FROM due
        WHERE j.id = due.id
      RETURNING j.id, j.type, j.payload, j.run_at, j.status, j.attempts, j.max_attempts,
                j.idempotency_key, j.last_error`,
      [limit, workerId, now()],
    );
    return rows;
  });
}

export async function completeJob(id: number): Promise<void> {
  await db.raw(
    `UPDATE jobs SET status = 'done', locked_by = NULL, locked_at = NULL, updated_at = now() WHERE id = $1`,
    [id],
  );
}

/** Retry with backoff, or dead-letter when attempts are exhausted. */
export async function failJob(id: number, error: string): Promise<"retrying" | "dead"> {
  const safe = error.slice(0, 500);
  const row = await db.q1<{ attempts: number; maxAttempts: number }>(
    `UPDATE jobs
        SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
            last_error = $2,
            run_at = now() + make_interval(secs => $3::double precision),
            locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE id = $1
      RETURNING attempts, max_attempts`,
    [id, safe, 0], // placeholder, replaced below
  );
  // Backoff needs the attempt count we just wrote; compute precisely:
  if (!row) return "dead";
  const delay = backoffSeconds(row.attempts);
  await db.raw(
    `UPDATE jobs SET run_at = now() + make_interval(secs => $2::double precision) WHERE id = $1 AND status = 'queued'`,
    [id, delay],
  );
  if (row.attempts >= row.maxAttempts) {
    log.error("job_dead_lettered", { jobId: id, error: safe });
    return "dead";
  }
  log.warn("job_retry_scheduled", { jobId: id, attempts: row.attempts, delaySeconds: delay });
  return "retrying";
}

/** Cancel queued jobs whose payload references an entity (e.g. a release case). */
export async function cancelJobsForPayload(
  type: string,
  match: Record<string, unknown>,
  exec: Queryable = db,
): Promise<number> {
  const res = await exec.raw(
    `UPDATE jobs
        SET status = 'canceled', canceled_at = now(), locked_by = NULL, locked_at = NULL, updated_at = now()
      WHERE status = 'queued' AND type = $1 AND payload @> $2::jsonb`,
    [type, JSON.stringify(match)],
  );
  return res.rowCount ?? 0;
}

export async function cancelJobByKey(key: string, exec: Queryable = db): Promise<void> {
  await exec.raw(
    `UPDATE jobs SET status = 'canceled', canceled_at = now(), updated_at = now()
      WHERE idempotency_key = $1 AND status = 'queued'`,
    [key],
  );
}

export interface QueueStats {
  queued: number;
  /** Queued jobs whose run_at is still in the future (scheduled work). */
  scheduled: number;
  running: number;
  doneRecent: number;
  failed: number;
  dead: number;
  /** Age of the oldest DUE job (run_at <= now). Null when nothing is due. */
  oldestQueuedAgeSeconds: number | null;
}

export async function queueStats(): Promise<QueueStats> {
  const rows = await db.q<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count FROM jobs GROUP BY status`,
  );
  const by: Record<string, number> = {};
  for (const r of rows) by[r.status] = r.count;
  const due = await db.q1<{ age: number | null; scheduled: number }>(
    `SELECT EXTRACT(EPOCH FROM (now() - min(run_at) FILTER (WHERE run_at <= now())))::int AS age,
            count(*) FILTER (WHERE run_at > now())::int AS scheduled
       FROM jobs WHERE status = 'queued'`,
  );
  return {
    queued: by.queued ?? 0,
    scheduled: due?.scheduled ?? 0,
    running: by.running ?? 0,
    doneRecent: by.done ?? 0,
    failed: by.failed ?? 0,
    dead: by.dead ?? 0,
    oldestQueuedAgeSeconds: due?.age ?? null,
  };
}

export async function heartbeat(workerId: string): Promise<void> {
  await db.raw(
    `INSERT INTO system_settings (key, value) VALUES ('worker_heartbeat', jsonb_build_object('worker', $1::text, 'at', now()::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [workerId],
  );
}

export interface HeartbeatInfo {
  at: Date | null;
  worker: string | null;
  fresh: boolean;
}

export async function workerHeartbeat(): Promise<HeartbeatInfo> {
  const row = await db.q1<{ value: { at?: string; worker?: string } | null }>(
    `SELECT value FROM system_settings WHERE key = 'worker_heartbeat'`,
  );
  const at = row?.value?.at ? new Date(row.value.at) : null;
  return {
    at,
    worker: row?.value?.worker ?? null,
    fresh: at ? Date.now() - at.getTime() < 120_000 : false,
  };
}
