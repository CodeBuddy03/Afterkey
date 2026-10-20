import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent } from "@/lib/auth/guards";
import { invalidateTokens, issueToken } from "@/lib/auth/tokens";
import { db, withTransaction } from "@/lib/db";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";
import { AUTH_LIMITS, limitByIp, limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { zEmail } from "@/lib/validation/common";

const schema = z.object({ email: zEmail() });

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, schema);

  const byIp = await limitByIp(ip, "auth:forgot", AUTH_LIMITS.passwordReset.limit, AUTH_LIMITS.passwordReset.windowSeconds);
  const byEmail = await rateLimit({
    key: limiterKey(["auth:forgot", body.email]),
    limit: 3,
    windowSeconds: 3600,
  });
  if (!byIp.ok || !byEmail.ok) {
    return fail(429, "rate_limited", "Too many reset requests. Try again in an hour.");
  }

  const user = await db.q1<{ id: string; email: string; status: string }>(
    `SELECT id, email, status FROM users WHERE email = $1`,
    [body.email],
  );

  if (user && user.status !== "deleted") {
    await withTransaction(async (tx) => {
      await invalidateTokens(tx, user.id, "password_reset");
      const token = await issueToken(tx, user.id, "password_reset", 30 * 60);
      await queueEmail(
        {
          to: user.email,
          template: "password_reset",
          rendered: renderEmail("password_reset", {
            url: appUrl(`/reset-password?token=${token.raw}`),
            expiresIn: "30 minutes",
          }),
          userId: user.id,
          relatedType: "user",
          relatedId: user.id,
        },
        tx,
      );
      await recordAudit(
        {
          action: "auth.password_reset_requested",
          actorType: "user",
          actorId: user.id,
          actorLabel: user.email,
          ip,
          userAgent,
        },
        tx,
      );
    });
  }

  // Identical response either way (no account enumeration).
  return ok({
    ok: true,
    message: "If an account exists for that address, a password reset link has been sent.",
  });
});

export const runtime = "nodejs";
