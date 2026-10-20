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
  token: z.string().min(10).max(400),
  password: zPassword(),
});

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({
    key: limiterKey(["auth:reset", ip ?? "local"]),
    limit: 10,
    windowSeconds: 900,
  });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");

  const body = await readJson(req, schema);

  const policy = checkPasswordPolicy(body.password);
  if (!policy.ok) return fail(400, "weak_password", "Please choose a stronger password.", issuesToDetails(policy.issues));

  const passwordHash = await hashPassword(body.password);

  const result = await withTransaction(async (tx) => {
    const consumed = await consumeToken(tx, body.token, "password_reset");
    if (!consumed) return { ok: false as const };

    const user = await tx.q1<{ id: string; email: string; status: string }>(
      `SELECT id, email, status FROM users WHERE id = $1 FOR UPDATE`,
      [consumed.userId],
    );
    if (!user || user.status === "deleted") return { ok: false as const };

    await tx.raw(
      `UPDATE users
          SET password_hash = $2, password_changed_at = now(), force_password_change = FALSE
        WHERE id = $1`,
      [user.id, passwordHash],
    );
    // Password change invalidates every session (including any stolen one).
    await tx.raw(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
    // Any outstanding MFA login challenge for this account is invalidated too.
    await tx.raw(
      `UPDATE email_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose = 'mfa_challenge' AND consumed_at IS NULL`,
      [user.id],
    );

    await queueEmail(
      {
        to: user.email,
        template: "account_change",
        rendered: renderEmail("account_change", {
          event: "password reset",
          time: new Date().toUTCString(),
          detail: "All sessions were signed out.",
          url: appUrl("/settings/security"),
        }),
        userId: user.id,
        relatedType: "user",
        relatedId: user.id,
        dedupeKey: `pwd-reset:${user.id}:${Math.floor(Date.now() / 600_000)}`,
      },
      tx,
    );
    await recordAudit(
      {
        action: "auth.password_reset_completed",
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
    return fail(400, "invalid_token", "This reset link is invalid or has expired. Request a new one.");
  }
  return ok({ ok: true, message: "Password updated. Please sign in with your new password." });
});

export const runtime = "nodejs";
