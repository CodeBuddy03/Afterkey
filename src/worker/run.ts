import { loadEnv } from "../../scripts/lib/load-env";

loadEnv();

/**
 * Background worker process.
 *
 *   npm run worker
 *
 * Runs the durable job queue: check-in reminders and escalation, release
 * execution, transactional email delivery and account-deletion jobs.
 * Fails closed: a thrown job error is retried with backoff, then dead-lettered;
 * nothing here ever releases content without the checks in release/engine.ts.
 */

async function main(): Promise<void> {
  const { env } = await import("../lib/env");
  const { log } = await import("../lib/logger");
  const { runWorkerCycle } = await import("../lib/jobs/worker");

  const cfg = env();
  const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  log.info("worker_started", { workerId, pollMs: cfg.WORKER_POLL_MS, batch: cfg.WORKER_BATCH });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Graceful shutdown: stop polling after the in-flight cycle, so SIGINT/SIGTERM
  // never abandons a half-run job.
  while (!stopping) {
    try {
      const result = await runWorkerCycle(workerId);
      if (result.jobsProcessed || result.jobsRetried || result.emailJobsEnqueued) {
        log.info("worker_cycle", { workerId, ...result });
      }
    } catch (err) {
      log.error("worker_cycle_failed", {
        workerId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
    if (stopping) break;
    await sleep(cfg.WORKER_POLL_MS);
  }

  log.info("worker_stopped", { workerId });
  process.exit(0);
}

let stopping = false;

const shutdown = () => {
  // Let the in-flight cycle finish naturally; force-exit after 10s.
  stopping = true;
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ level: "error", msg: "worker_unhandled_rejection", reason: String(reason) }));
  process.exit(1);
});

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: "worker_fatal", error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
