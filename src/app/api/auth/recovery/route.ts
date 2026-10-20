import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent } from "@/lib/auth/guards";
import { issueToken } from "@/lib/auth/tokens";
import { db } from "@/lib/db";
import { verifyRecoveryPhrase } from "@/lib/crypto/recovery";
import { recordAudit } from "@/lib/security/audit";
import { rateLimit, limiterKey } from "@/lib/security/rate-limit";

const schema = z.object({
  phrase: z.string().min(10).max(600),
  email: z.string().trim().max(320),
});

/**
 * Step 1 of recovery: proves possession of the 24-word recovery phrase.
 *
 * The phrase derives a key whose verifier is stored server-side; nothing here
 * can reveal the phrase, and online attempts are heavily rate-limited
 * (PBKDF2-SHA256 × 210,000 iterations also slows offline guessing).
 * On success a single-use 15-minute challenge allows setting a new password —
 * the phrase never becomes a login credential.
 */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, schema);

  const limit = await rateLimit({
    key: limiterKey(["auth:recovery", ip ?? "local"]),
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) return fail(429, "rate_limited", "Too many recovery attempts. Try again later.");

  const email = body.email.toLowerCase();
  const user = await db.q1<{ id: string; status: string }>(
    `SELECT id, status FROM users WHERE email = $1 AND status <> 'deleted'`,
    [email],
  );
  const vault = user
    ? await db.q1<{ recoveryVerifier: string | null }>(
        `SELECT k.recovery_verifier
           FROM vault_keys k JOIN vaults v ON v.id = k.vault_id
          WHERE v.user_id = $1`,
        [user.id],
      )
    : null;

  const okPhrase = Boolean(
    user && vault?.recoveryVerifier && verifyRecoveryPhrase(body.phrase, vault.recoveryVerifier),
  );

  await recordAudit({
    action: "auth.recovery_attempt",
    actorType: "system",
    actorLabel: email,
    ip,
    userAgent,
    metadata: { result: okPhrase ? "phrase_valid" : "phrase_invalid" },
  });

  if (!okPhrase || !user) {
    return fail(400, "invalid_phrase", "That recovery phrase is not correct for this account.");
  }

  const challenge = await issueToken(db, user.id, "recovery_challenge", 15 * 60);
  return ok({
    challenge: challenge.raw,
    expiresAt: challenge.expiresAt.toISOString(),
    message: "Recovery phrase verified. Set a new password to regain access.",
  });
});

export const runtime = "nodejs";
