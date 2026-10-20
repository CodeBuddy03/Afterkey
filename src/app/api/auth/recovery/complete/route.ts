import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent } from "@/lib/auth/guards";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { consumeToken } from "@/lib/auth/tokens";
import { withTransaction } from "@/lib/db";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";
import { rateLimit, limiterKey } from "@/lib/security/rate-limit";
import { issuesToDetails, zPassword } from "@/lib/validation/common";

const schema = z.object({
  challenge: z.string().min(10).max(400),
  password: zPassword(),
});

/** Step 2 of recovery: single-use challenge + new password. */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({
    key: limiterKey(["auth:recovery_complete", ip ?? "local"]),
    limit: 10,
    windowSeconds: 900,
  });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");

  const body = await readJson(req, schema);
  const policy = checkPasswordPolicy(body.password);
  if (!policy.ok) return fail(400, "weak_password", "Please choose a stronger password.", issuesToDetails(policy.issues));

  const passwordHash = await hashPassword(body.password);

  const result = await withTransaction(async (tx) => {
    const consumed = await consumeToken(tx, body.challenge, "recovery_challenge");
    if (!consumed) return { ok: false as const };
    const user = await tx.q1<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1 FOR UPDATE`,
      [consumed.userId],
    );
    if (!user) return { ok: false as const };

    await tx.raw(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), force_password_change = FALSE WHERE id = $1`,
      [user.id, passwordHash],
    );
    await tx.raw(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
    // One-time tokens are single-use by design; ensure no other pending ones survive.
    await tx.raw(
      `UPDATE email_tokens SET consumed_at = now()
        WHERE user_id = $1 AND consumed_at IS NULL AND purpose IN ('password_reset', 'mfa_challenge', 'recovery_challenge')`,
      [user.id],
    );

    await queueEmail(
      {
        to: user.email,
        template: "account_change",
        rendered: renderEmail("account_change", {
          event: "password changed through recovery phrase",
          time: new Date().toUTCString(),
          detail: "All sessions were signed out. If this was not you, contact support immediately.",
          url: appUrl("/settings/security"),
        }),
        userId: user.id,
        relatedType: "user",
        relatedId: user.id,
      },
      tx,
    );
    await recordAudit(
      {
        action: "auth.recovery_completed",
        actorType: "user",
        actorId: user.id,
        actorLabel: user.email,
        ip,
        userAgent,
      },
      tx,
    );
    return { ok: true as const };
  });

  if (!result.ok) {
    return fail(400, "invalid_challenge", "This recovery session expired. Start again.");
  }
  return ok({ ok: true, message: "Password updated. All other sessions were signed out. Please sign in." });
});

export const runtime = "nodejs";
