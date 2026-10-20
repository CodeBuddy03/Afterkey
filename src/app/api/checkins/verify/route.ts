import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { getActiveCaseForUser, submitOwnerOtp } from "@/lib/release/engine";

/**
 * POST /api/checkins/verify — owner submits the one-time release code.
 *
 * The code was emailed when the release case opened. A successful submission
 * satisfies the email_otp procedure and schedules the (still cancellable)
 * release; an incorrect code never consumes the case and is rate limited.
 */

const verifySchema = z.object({ code: z.string().trim().min(4).max(12) });

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, verifySchema);

  const limit = await rateLimit({
    key: limiterKey(["checkins:verify", ctx.user.id]),
    limit: 10,
    windowSeconds: 900,
  });
  if (!limit.ok) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Please wait 15 minutes and try again.");
  }

  const result = await submitOwnerOtp(ctx.user.id, body.code);
  if (!result.satisfied) {
    throw new ApiError(400, "invalid_code", "That code is not valid for the pending release. Check your latest email.");
  }

  await recordAudit({
    action: "release.otp_verified",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "release_case",
  });

  const activeCase = await getActiveCaseForUser(ctx.user.id);
  return ok({
    verified: true,
    case: activeCase
      ? { id: activeCase.id, state: activeCase.state, releaseAt: activeCase.releaseAt, scheduleState: activeCase.scheduleState }
      : null,
  });
});

export const runtime = "nodejs";
