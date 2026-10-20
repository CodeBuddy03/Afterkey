import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent } from "@/lib/auth/guards";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { getContactVerificationView, submitContactAttestation } from "@/lib/release/engine";

/**
 * Trusted-contact verification for a pending release case.
 *
 * These endpoints are token-gated, not session-gated: the contact follows a
 * single-use, hashed, expiring link from their email and may not have an
 * account. The token never appears in responses and every attempt is rate
 * limited per IP. Nothing is disclosed here beyond the owner's display name.
 */

const tokenSchema = z.object({ token: z.string().trim().min(20).max(80) });
const attestSchema = z.object({ decision: z.enum(["confirm_unavailable", "cannot_confirm"]) });

const NO_STORE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } as const;

async function rateLimitToken(ip: string | null): Promise<void> {
  const limit = await rateLimit({
    key: limiterKey(["verify-case", ip]),
    limit: 20,
    windowSeconds: 900,
  });
  if (!limit.ok) {
    throw new ApiError(429, "rate_limited", "Too many attempts. Please wait 15 minutes and try again.");
  }
}

/** GET /api/verify-case/[token] — what the contact sees before attesting. */
export const GET = handleRoute(async (req, routeCtx) => {
  const { ip } = await currentIpAndAgent();
  await rateLimitToken(ip);

  const parsed = tokenSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_token", "This verification link is not valid.");
  const view = await getContactVerificationView(parsed.data.token);
  if (!view) {
    throw new ApiError(404, "not_found", "This verification link is invalid, used, or has expired.");
  }
  return ok(
    {
      caseId: view.caseId,
      ownerName: view.ownerName,
      method: view.method,
      openedAt: view.openedAt,
    },
    { headers: NO_STORE },
  );
});

/** POST /api/verify-case/[token] — the contact attests for or against. */
export const POST = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  await rateLimitToken(ip);

  const parsed = tokenSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_token", "This verification link is not valid.");
  const body = await readJson(req, attestSchema);

  const result = await submitContactAttestation(parsed.data.token, body.decision, { ip, userAgent });
  if (!result.ok) {
    throw new ApiError(400, "invalid_token", "This verification link is invalid, used, or has expired.");
  }

  return ok(
    {
      ok: true,
      // A "confirm" attestation only satisfies the procedure; the release still
      // observes the delay window and can be cancelled by the owner at any time.
      scheduled: result.reason === "scheduled",
      message:
        body.decision === "confirm_unavailable"
          ? "Thank you. Your response has been recorded."
          : "Thank you. Your response has been recorded; the release will not proceed on your attestation.",
    },
    { headers: NO_STORE },
  );
});

export const runtime = "nodejs";
