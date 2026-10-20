import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  backoffSeconds,
  cancelJobsForPayload,
  claimDueJobs,
  completeJob,
  enqueue,
  failJob,
  queueStats,
} from "@/lib/jobs/queue";

describe("job queue", () => {
  it("enqueues idempotently", async () => {
    const first = await enqueue({ type: "it.job", payload: { n: 1 }, idempotencyKey: "it:queue:idem" });
    const second = await enqueue({ type: "it.job", payload: { n: 2 }, idempotencyKey: "it:queue:idem" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const rows = await db.q<{ payload: { n: number } }>(`SELECT payload FROM jobs WHERE idempotency_key = $1`, [
      "it:queue:idem",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.n).toBe(1); // first write wins
  });

  it("claims only due jobs, exactly once per job", async () => {
    const due = await enqueue({ type: "it.claim", runAt: new Date(Date.now() - 1_000) });
    const future = await enqueue({ type: "it.claim", runAt: new Date(Date.now() + 3_600_000) });
    expect(due).not.toBeNull();
    expect(future).not.toBeNull();

    const first = await claimDueJobs("worker-1", 50);
    const claimedIds = first.map((j) => j.id);
    expect(claimedIds).toContain(due);
    expect(claimedIds).not.toContain(future);
    expect(first.find((j) => j.id === due)!.attempts).toBe(1);

    // A second worker sees nothing runnable (SKIP LOCKED + status guard).
    const second = await claimDueJobs("worker-2", 50);
    expect(second.find((j) => j.id === due)).toBeUndefined();
    expect(second.find((j) => j.id === future)).toBeUndefined();

    await completeJob(due!);
    const row = await db.q1<{ status: string; lockedBy: string | null }>(
      `SELECT status, locked_by FROM jobs WHERE id = $1`,
      [due],
    );
    expect(row!.status).toBe("done");
    expect(row!.lockedBy).toBeNull();

    await db.raw(`UPDATE jobs SET status = 'canceled' WHERE id = $1`, [future]);
  });

  it("retries with exponential backoff, then dead-letters", async () => {
    const id = await enqueue({ type: "it.fail", maxAttempts: 2 });
    expect(id).not.toBeNull();

    await claimDueJobs("worker-1", 10); // attempts -> 1
    expect(await failJob(id!, "boom 1")).toBe("retrying");
    const retry = await db.q1<{ status: string; lastError: string; runAt: Date }>(
      `SELECT status, last_error, run_at FROM jobs WHERE id = $1`,
      [id],
    );
    expect(retry!.status).toBe("queued");
    expect(retry!.lastError).toBe("boom 1");
    const delayMs = new Date(retry!.runAt).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(20_000); // ~30s backoff
    expect(delayMs).toBeLessThan(45_000);
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(60);

    // Force the retry due (past the claim transaction's now() to avoid clock skew), fail again ->
    // attempts (2) >= maxAttempts (2) -> dead.
    await db.raw(`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = $1`, [id]);
    await claimDueJobs("worker-1", 10);
    expect(await failJob(id!, "boom 2")).toBe("dead");
    const dead = await db.q1<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [id]);
    expect(dead!.status).toBe("dead");
  });

  it("cancels queued jobs whose payload references an entity", async () => {
    const id = await enqueue({ type: "it.cancel", payload: { caseId: "case-123" } });
    const other = await enqueue({ type: "it.cancel", payload: { caseId: "case-456" } });

    const n = await cancelJobsForPayload("it.cancel", { caseId: "case-123" });
    expect(n).toBe(1);

    const rows = await db.q<{ id: number; status: string }>(
      `SELECT id, status FROM jobs WHERE id IN ($1, $2)`,
      [id, other],
    );
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(id!)).toBe("canceled");
    expect(byId.get(other!)).toBe("queued");
  });

  it("reports queue stats without negative ages when the queue is scheduled ahead", async () => {
    // Regression: min(run_at) over future jobs used to yield a negative "age".
    await db.raw(`UPDATE jobs SET status = 'canceled' WHERE status IN ('queued', 'running')`);
    await enqueue({ type: "it.stats", runAt: new Date(Date.now() + 3_600_000) });
    await enqueue({ type: "it.stats", runAt: new Date(Date.now() + 7_200_000) });

    const ahead = await queueStats();
    expect(ahead.scheduled).toBeGreaterThanOrEqual(2);
    expect(ahead.oldestQueuedAgeSeconds === null || ahead.oldestQueuedAgeSeconds >= 0).toBe(true);

    await enqueue({ type: "it.stats", runAt: new Date(Date.now() - 5_000) });
    const withDue = await queueStats();
    expect(withDue.oldestQueuedAgeSeconds).not.toBeNull();
    expect(withDue.oldestQueuedAgeSeconds!).toBeGreaterThanOrEqual(0);
    expect(withDue.oldestQueuedAgeSeconds!).toBeLessThan(300);
  });
});
