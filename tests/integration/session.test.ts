import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createSession,
  resolveSession,
  revokeAllSessions,
  revokeSessionByToken,
} from "@/lib/auth/session";
import { sha256Hex } from "@/lib/crypto/encryption";
import { createTestUser } from "./helpers";

describe("database sessions", () => {
  it("creates and resolves a session, mapping camelized user columns", async () => {
    const u = await createTestUser();
    const { token, session } = await createSession(u.id, { ip: "203.0.113.9", userAgent: "vitest" });

    const ctx = await resolveSession(token);
    expect(ctx).not.toBeNull();
    expect(ctx!.user.id).toBe(u.id);
    expect(ctx!.user.email).toBe(u.email);
    expect(ctx!.user.status).toBe("active");
    expect(ctx!.user.fullName).toBe("Integration Tester");
    expect(ctx!.user.mfaEnabled).toBe(false);
    expect(ctx!.user.timezone).toBe("Africa/Nairobi");
    expect(ctx!.session.id).toBe(session.id);

    // Only the hash is persisted — never the raw token or raw IP.
    const row = await db.q1<{ tokenHash: string; ipHash: string | null }>(
      `SELECT token_hash, ip_hash FROM sessions WHERE id = $1`,
      [session.id],
    );
    expect(row!.tokenHash).toBe(sha256Hex(token));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.ipHash).toBeTruthy();
    expect(row!.ipHash).not.toContain("203.0.113.9");
  });

  it("rejects revoked, expired and suspended subjects", async () => {
    const u = await createTestUser();
    const a = await createSession(u.id);
    const b = await createSession(u.id);

    await revokeSessionByToken(a.token);
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).not.toBeNull();

    // Suspended users cannot authenticate even with a live session.
    await db.raw(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
    expect(await resolveSession(b.token)).toBeNull();
    await db.raw(`UPDATE users SET status = 'active' WHERE id = $1`, [u.id]);

    const c = await createSession(u.id);
    await db.raw(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [c.session.id]);
    expect(await resolveSession(c.token)).toBeNull();

    const d = await createSession(u.id);
    const revoked = await revokeAllSessions(u.id, d.session.id);
    expect(revoked).toBeGreaterThanOrEqual(2); // b and c (a already revoked)
    expect(await resolveSession(d.token)).not.toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
  });

  it("slides expiry when a session has been idle beyond 5 minutes", async () => {
    const u = await createTestUser();
    const { token, session } = await createSession(u.id);
    await db.raw(
      `UPDATE sessions SET last_seen_at = now() - interval '10 minutes', expires_at = now() + interval '1 day'
        WHERE id = $1`,
      [session.id],
    );

    const ctx = await resolveSession(token);
    expect(ctx).not.toBeNull();

    const after = await db.q1<{ expiresAt: Date }>(`SELECT expires_at FROM sessions WHERE id = $1`, [session.id]);
    // Extended to the full session TTL (30 days), well beyond the old expiry.
    expect(new Date(after!.expiresAt).getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
  });
});
