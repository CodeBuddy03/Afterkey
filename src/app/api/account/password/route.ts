import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/password";
import { withTransaction } from "@/lib/db";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { issuesToDetails, zPassword } from "@/lib/validation/common";

const schema = z.object({
  currentPassword: zPassword(),
  newPassword: zPassword(),
});

/** Change password: verifies the current one, revokes every other session. */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({
    key: limiterKey(["account:password", ctx.user.id]),
    limit: 10,
    windowSeconds: 900,
  });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");

  const body = await readJson(req, schema);

  const row = await dbHash(ctx.user.id);
  if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, body.currentPassword))) {
    await recordAudit({
      action: "account.password_change_failed",
      actorType: "user",
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      ip,
      userAgent,
    });
    return fail(401, "invalid_password", "Your current password is not correct.");
  }

  const policy = checkPasswordPolicy(body.newPassword);
  if (!policy.ok) return fail(400, "weak_password", "Please choose a stronger password.", issuesToDetails(policy.issues));

  const newHash = await hashPassword(body.newPassword);
  const revoked = await withTransaction(async (tx) => {
    await tx.raw(
      `UPDATE users SET password_hash = $2, password_changed_at = now(), force_password_change = FALSE WHERE id = $1`,
      [ctx.user.id, newHash],
    );
    const res = await tx.raw(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`,
      [ctx.user.id, ctx.session.id],
    );
    await queueEmail(
      {
        to: ctx.user.email,
        template: "account_change",
        rendered: renderEmail("account_change", {
          event: "password changed",
          time: new Date().toUTCString(),
          detail: `${res.rowCount ?? 0} other session(s) were signed out.`,
          url: appUrl("/settings/security"),
        }),
        userId: ctx.user.id,
        dedupeKey: `pwd-change:${ctx.user.id}:${Math.floor(Date.now() / 600_000)}`,
      },
      tx,
    );
    await recordAudit(
      {
        action: "account.password_changed",
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.email,
        ip,
        userAgent,
        metadata: { revokedSessions: res.rowCount ?? 0 },
      },
      tx,
    );
    // Keep this session reauthenticated after a password change.
    await tx.raw(`UPDATE sessions SET reauth_at = now() WHERE id = $1`, [ctx.session.id]);
    return res.rowCount ?? 0;
  });

  return ok({ ok: true, revokedSessions: revoked, message: "Password updated." });
});

async function dbHash(userId: string): Promise<{ passwordHash: string | null } | null> {
  const { db } = await import("@/lib/db");
  return db.q1<{ passwordHash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
}

export const runtime = "nodejs";
