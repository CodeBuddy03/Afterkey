import { env } from "../env";
import { log } from "../logger";
import { refreshClock } from "../clock";
import { claimDueJobs, completeJob, failJob, heartbeat, reclaimStaleJobs } from "./queue";
import { ensureEmailJobs, runCheckinMaintenance, runJob } from "./processors";
import { purgeExpiredTokens } from "../auth/tokens";
import { db } from "../db";

/**
 * One worker iteration: clock refresh → heartbeat → stale-job reclaim →
 * check-in maintenance → email job ensure → run due jobs.
 * Shared by the standalone worker process and the test-only tick endpoint.
 */

let lastHousekeepingAt = 0;

export interface CycleResult {
  jobsProcessed: number;
  jobsRetried: number;
  emailJobsEnqueued: number;
  maintenance: { schedules: number; enqueued: number };
}

export async function runWorkerCycle(
  workerId: string,
  opts: { maxJobs?: number } = {},
): Promise<CycleResult> {
  const cfg = env();
  await refreshClock();
  await heartbeat(workerId).catch((err: unknown) => {
    log.warn("heartbeat_failed", { error: err instanceof Error ? err.message : "unknown" });
  });
  await reclaimStaleJobs().catch(() => undefined);

  const maintenance = await runCheckinMaintenance();
  const emailJobsEnqueued = await ensureEmailJobs();

  // Hourly housekeeping (cheap, idempotent).
  if (Date.now() - lastHousekeepingAt > 3_600_000) {
    lastHousekeepingAt = Date.now();
    await purgeExpiredTokens().catch(() => undefined);
    await db.raw(`DELETE FROM rate_limits WHERE expires_at < now() - interval '1 day'`).catch(() => undefined);
    await db.raw(`DELETE FROM jobs WHERE status = 'done' AND updated_at < now() - interval '7 days'`).catch(() => undefined);
    await db.raw(`DELETE FROM email_messages WHERE status = 'sent' AND created_at < now() - interval '30 days'`).catch(() => undefined);
  }

  const jobs = await claimDueJobs(workerId, opts.maxJobs ?? cfg.WORKER_BATCH);
  let jobsProcessed = 0;
  let jobsRetried = 0;

  for (const job of jobs) {
    try {
      await runJob(job);
      await completeJob(job.id);
      jobsProcessed += 1;
    } catch (err) {
      jobsRetried += 1;
      const message = err instanceof Error ? err.message : "unknown job error";
      log.error("job_failed", { jobId: job.id, type: job.type, attempts: job.attempts, error: message });
      await failJob(job.id, message).catch(() => undefined);
    }
  }

  return { jobsProcessed, jobsRetried, emailJobsEnqueued, maintenance };
}
