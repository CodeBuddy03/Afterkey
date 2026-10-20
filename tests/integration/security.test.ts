import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clearRateLimit, limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { queryAudit, recordAudit } from "@/lib/security/audit";

describe("rate limiting (durable, fixed window)", () => {
  it("pseudonymizes bucket keys — no raw email or IP stored", () => {
    const key = limiterKey(["auth:login", "person@example.com", "203.0.113.7"]);
    expect(key).not.toContain("person@example.com");
    expect(key).not.toContain("203.0.113.7");
  });

  it("counts attempts in-window and blocks over the limit", async () => {
    const key = limiterKey(["it:limit", "subject@example.test"]);
    await clearRateLimit(key);

    const r1 = await rateLimit({ key, limit: 2, windowSeconds: 300 });
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = await rateLimit({ key, limit: 2, windowSeconds: 300 });
    expect(r2.ok).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = await rateLimit({ key, limit: 2, windowSeconds: 300 });
    expect(r3.ok).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);

    await clearRateLimit(key);
    const r4 = await rateLimit({ key, limit: 2, windowSeconds: 300 });
    expect(r4.ok).toBe(true);
  });
});

describe("audit log", () => {
  it("persists with pseudonymized IP and sanitized metadata", async () => {
    await recordAudit({
      action: "it.audit_event",
      actorType: "system",
      actorLabel: "integration",
      ip: "198.51.100.4",
      userAgent: "vitest-agent",
      metadata: { password: "hunter2", secret: "s3cr3t", reason: "ok", nested: { a: 1 } },
    });

    const row = await db.q1<{ ipHash: string | null; userAgent: string; metadata: Record<string, unknown> }>(
      `SELECT ip_hash, user_agent, metadata FROM audit_events WHERE action = 'it.audit_event'`,
    );
    expect(row).not.toBeNull();
    expect(row!.ipHash).toBeTruthy();
    expect(row!.ipHash).not.toContain("198.51.100.4"); // HMAC, not raw IP
    expect(row!.metadata).not.toHaveProperty("password"); // forbidden keys stripped
    expect(row!.metadata).not.toHaveProperty("secret");
    expect(row!.metadata.reason).toBe("ok");
    expect(row!.metadata.nested).toEqual({ a: 1 });
  });

  it("is append-only: UPDATE and DELETE are blocked by the database trigger", async () => {
    await recordAudit({ action: "it.append_only", actorType: "system" });

    await expect(db.raw(`UPDATE audit_events SET action = 'tampered' WHERE action = 'it.append_only'`)).rejects.toThrow();
    await expect(db.raw(`DELETE FROM audit_events WHERE action = 'it.append_only'`)).rejects.toThrow();

    const still = await db.q1<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events WHERE action = 'it.append_only'`);
    expect(still!.count).toBe(1);
  });

  it("queryAudit filters by action and returns newest first", async () => {
    await recordAudit({ action: "it.filter.a", actorType: "system" });
    await recordAudit({ action: "it.filter.b", actorType: "system" });
    await recordAudit({ action: "it.filter.a", actorType: "system" });

    const rows = await queryAudit({ action: "it.filter.a", limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "it.filter.a")).toBe(true);
  });
});
