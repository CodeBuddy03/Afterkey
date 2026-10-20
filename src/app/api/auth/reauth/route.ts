import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { markReauth } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/security/audit";
import { AUTH_LIMITS, limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { zPassword } from "@/lib/validation/common";

const schema = z.object({ password: zPassword() });

/**
 * Reauthentication: confirms the password again so sensitive actions
 * (release cancellation, credential access, deletion) are protected even if a
 * session cookie is stolen. Marks the session reauthenticated for 15 minutes.
 */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({
    key: limiterKey(["auth:reauth", ctx.user.id, ip ?? "local"]),
    limit: AUTH_LIMITS.reauth.limit,
    windowSeconds: AUTH_LIMITS.reauth.windowSeconds,
  });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");

  const body = await readJson(req, schema);
  const row = await db.q1<{ passwordHash: string | null; forcePasswordChange: boolean }>(
    `SELECT password_hash, force_password_change FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  const valid = row?.passwordHash ? await verifyPassword(row.passwordHash, body.password) : false;

  if (!valid) {
    await recordAudit({
      action: "auth.reauth_failed",
      actorType: "user",
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      ip,
      userAgent,
    });
    return fail(401, "invalid_password", "That password is not correct.");
  }

  await markReauth(ctx.session.id);
  await recordAudit({
    action: "auth.reauth_success",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
  });
  return ok({ ok: true, validMinutes: 15 });
});

export const runtime = "nodejs";
