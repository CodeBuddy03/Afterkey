import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { consumeToken, invalidateTokens, issueToken } from "@/lib/auth/tokens";
import { createTestUser } from "./helpers";

describe("single-use tokens", () => {
  it("issues hashed and consumes once (replay rejected)", async () => {
    const u = await createTestUser();
    const t = await issueToken(db, u.id, "email_verify", 3600);

    const stored = await db.q1<{ tokenHash: string }>(`SELECT token_hash FROM email_tokens WHERE user_id = $1`, [
      u.id,
    ]);
    expect(stored!.tokenHash).not.toBe(t.raw); // raw token never persisted

    const used = await consumeToken(db, t.raw, "email_verify");
    expect(used).not.toBeNull();
    expect(used!.userId).toBe(u.id);
    expect(used!.purpose).toBe("email_verify");

    expect(await consumeToken(db, t.raw, "email_verify")).toBeNull(); // replay
  });

  it("isolates purposes from each other", async () => {
    const u = await createTestUser();
    const t = await issueToken(db, u.id, "password_reset", 3600);

    expect(await consumeToken(db, t.raw, "email_verify")).toBeNull(); // wrong channel
    expect(await consumeToken(db, t.raw, "password_reset")).not.toBeNull(); // right channel still works
  });

  it("rejects expired tokens", async () => {
    const u = await createTestUser();
    const t = await issueToken(db, u.id, "password_reset", -10);
    expect(await consumeToken(db, t.raw, "password_reset")).toBeNull();
  });

  it("locks out an unclaimed token after repeated failed attempts", async () => {
    const u = await createTestUser();
    const t = await issueToken(db, u.id, "password_reset", 3600, {}, "fixed-raw-for-attempt-test");

    // Simulate an attacker grinding an unclaimable (expired) token.
    await db.raw(`UPDATE email_tokens SET expires_at = now() - interval '1 hour' WHERE user_id = $1`, [u.id]);
    for (let i = 0; i < 5; i += 1) {
      expect(await consumeToken(db, t.raw, "password_reset")).toBeNull();
    }
    const row = await db.q1<{ attempts: number }>(`SELECT attempts FROM email_tokens WHERE user_id = $1`, [u.id]);
    expect(row!.attempts).toBeGreaterThanOrEqual(5);

    // Even if the token becomes valid again, the attempt counter blocks it.
    await db.raw(`UPDATE email_tokens SET expires_at = now() + interval '1 hour' WHERE user_id = $1`, [u.id]);
    expect(await consumeToken(db, t.raw, "password_reset")).toBeNull();
  });

  it("invalidateTokens kills outstanding tokens for a purpose", async () => {
    const u = await createTestUser();
    const t = await issueToken(db, u.id, "password_reset", 3600);
    await invalidateTokens(db, u.id, "password_reset");
    expect(await consumeToken(db, t.raw, "password_reset")).toBeNull();
  });
});
