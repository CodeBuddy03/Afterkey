import { z } from "zod";
import { ApiError, handleRoute, ok } from "@/lib/api/http";
import { currentIpAndAgent } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { markDeliveryViewed } from "@/lib/release/engine";
import { resolveDeliveryToken } from "@/lib/release/delivery-access";

/**
 * Recipient delivery access (listing).
 *
 * The release_ready email carries a hashed, expiring token that maps to
 * exactly one delivery. No session is required, the token never appears in
 * responses, and only the items in the stored package are ever visible.
 */

const tokenSchema = z.object({ token: z.string().trim().min(20).max(80) });

/** GET /api/access/[token] — what was released to this recipient. */
export const GET = handleRoute(async (req, routeCtx) => {
  const { ip, userAgent } = await currentIpAndAgent();
  const parsed = tokenSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_token", "This delivery link is not valid.");

  const limit = await rateLimit({ key: limiterKey(["access", ip]), limit: 60, windowSeconds: 300 });
  if (!limit.ok) throw new ApiError(429, "rate_limited", "Too many requests. Please try again shortly.");

  const ctx = await resolveDeliveryToken(parsed.data.token);

  await markDeliveryViewed(ctx.deliveryId);
  await recordAudit({
    action: "release.delivery_viewed",
    actorType: "recipient",
    actorId: ctx.recipientId,
    ip,
    userAgent,
    targetType: "release_delivery",
    targetId: ctx.deliveryId,
    metadata: { caseId: ctx.caseId, items: ctx.packageItems.length },
  });

  return ok(
    {
      ownerName: ctx.ownerName ?? "Someone you know",
      caseId: ctx.caseId,
      availableAt: ctx.availableAt,
      items: ctx.packageItems.map((p) => ({ id: p.id, type: p.type, title: p.title })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
});

export const runtime = "nodejs";
