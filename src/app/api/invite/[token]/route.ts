import { z } from "zod";
import { ApiError, handleRoute, ok } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto/encryption";

/**
 * Recipient invitation acceptance.
 *
 * The raw token only ever exists in the invitation email; the database stores
 * its hash. Accepting links the recipient row to the signed-in account, and
 * the signed-in email must be the invited address — a forwarded link alone is
 * never enough to receive someone's vault content.
 */

const tokenSchema = z.object({ token: z.string().trim().min(20).max(80) });

interface InviteRow {
  id: string;
  email: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  recipientId: string;
  recipientName: string;
  recipientStatus: string;
  linkedUserId: string | null;
  ownerName: string | null;
}

async function loadInvite(token: string): Promise<InviteRow | null> {
  return db.q1<InviteRow>(
    `SELECT i.id, i.email, i.expires_at, i.accepted_at, i.revoked_at,
            r.id AS recipient_id, r.display_name AS recipient_name, r.status AS recipient_status,
            r.linked_user_id, u.full_name AS owner_name
       FROM recipient_invitations i
       JOIN recipients r ON r.id = i.recipient_id
       JOIN vaults v ON v.id = i.vault_id
       LEFT JOIN users u ON u.id = v.user_id
      WHERE i.token_hash = $1`,
    [sha256Hex(token)],
  );
}

/** GET /api/invite/[token] — safe metadata for the invitation page. */
export const GET = handleRoute(async (_req, routeCtx) => {
  const parsed = tokenSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_token", "This invitation link is not valid.");
  const invite = await loadInvite(parsed.data.token);
  if (!invite) throw new ApiError(404, "not_found", "This invitation link is not valid.");

  const now = Date.now();
  const state = invite.revokedAt
    ? "revoked"
    : invite.acceptedAt || invite.linkedUserId
      ? "accepted"
      : new Date(invite.expiresAt).getTime() < now
        ? "expired"
        : "pending";

  return ok(
    {
      state,
      email: invite.email,
      recipientName: invite.recipientName,
      ownerName: invite.ownerName ?? "An AfterKey user",
      expiresAt: invite.expiresAt,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
});

/** POST /api/invite/[token] — accept while signed in as the invited address. */
export const POST = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const parsed = tokenSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_token", "This invitation link is not valid.");

  const limit = await rateLimit({ key: limiterKey(["invite:accept", ctx.user.id]), limit: 20, windowSeconds: 3600 });
  if (!limit.ok) throw new ApiError(429, "rate_limited", "Too many attempts. Please try again later.");

  const invite = await loadInvite(parsed.data.token);
  if (!invite) throw new ApiError(404, "not_found", "This invitation link is not valid.");
  if (invite.revokedAt) throw new ApiError(410, "revoked", "This invitation was withdrawn by its sender.");
  if (invite.acceptedAt || invite.linkedUserId) {
    throw new ApiError(409, "already_accepted", "This invitation has already been accepted.");
  }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    throw new ApiError(410, "expired", "This invitation has expired. Ask the sender for a new one.");
  }
  if (invite.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
    throw new ApiError(403, "email_mismatch", `This invitation was sent to ${invite.email}. Sign in with that address to accept.`);
  }

  await db.raw(
    `UPDATE recipient_invitations SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`,
    [invite.id],
  );
  await db.raw(
    `UPDATE recipients SET status = 'active', linked_user_id = $2 WHERE id = $1 AND linked_user_id IS NULL`,
    [invite.recipientId, ctx.user.id],
  );
  // Any other pending invitation for this recipient is now redundant.
  await db.raw(
    `UPDATE recipient_invitations SET revoked_at = now()
      WHERE recipient_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [invite.recipientId],
  );

  await recordAudit({
    action: "recipient.invitation_accepted",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "recipient",
    targetId: invite.recipientId,
    metadata: { invitationId: invite.id },
  });

  return ok({ accepted: true, recipientName: invite.recipientName });
});

export const runtime = "nodejs";
