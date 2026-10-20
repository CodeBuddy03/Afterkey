import { handleRoute, ok } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { invalidateTokens, issueToken } from "@/lib/auth/tokens";
import { withTransaction } from "@/lib/db";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";

/** Re-send the email confirmation message (rate-limited, enumeration-safe). */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({
    key: limiterKey(["auth:resend_verify", ctx.user.id]),
    limit: 3,
    windowSeconds: 3600,
  });
  if (limit.ok === false) {
    return Response.json(
      { error: { code: "rate_limited", message: "You can request a new confirmation email up to 3 times per hour." } },
      { status: 429 },
    );
  }

  if (!ctx.user.emailVerifiedAt) {
    await withTransaction(async (tx) => {
      await invalidateTokens(tx, ctx.user.id, "email_verify");
      const token = await issueToken(tx, ctx.user.id, "email_verify", 24 * 3600);
      await queueEmail(
        {
          to: ctx.user.email,
          template: "verify_email",
          rendered: renderEmail("verify_email", {
            name: ctx.user.fullName ?? "",
            url: appUrl(`/verify-email?token=${token.raw}`),
            expiresIn: "24 hours",
          }),
          userId: ctx.user.id,
          relatedType: "user",
          relatedId: ctx.user.id,
        },
        tx,
      );
      await recordAudit(
        { action: "auth.verification_resent", actorType: "user", actorId: ctx.user.id, actorLabel: ctx.user.email, ip, userAgent },
        tx,
      );
    });
  }

  return ok({ ok: true, message: "Check your inbox for a confirmation link." });
});

export const runtime = "nodejs";
