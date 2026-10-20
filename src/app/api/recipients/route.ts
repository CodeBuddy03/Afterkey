import { assertRecipientQuota } from "@/lib/billing/entitlements";
import { z } from "zod";
import { ApiError, created, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser, requireVerified } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { rateLimit, limiterKey } from "@/lib/security/rate-limit";
import { zEmail, zShortText } from "@/lib/validation/common";
import { db } from "@/lib/db";
import { vaultIdOf } from "@/lib/vault/modules";
import { PERMISSION_CATEGORIES } from "@/lib/vault/message-schemas";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { randomToken, sha256Hex } from "@/lib/crypto/encryption";

/**
 * Trusted recipients: invitations, permissions and revocation.
 *
 * Every query is scoped by the caller's own vault. Permission grants are
 * per-recipient and explicit — there is no vault-wide sharing primitive.
 */

const createSchema = z.object({
  displayName: zShortText(120),
  email: zEmail(),
  relationship: zShortText(80).optional(),
  permissions: z.array(z.enum(PERMISSION_CATEGORIES)).max(5).optional(),
});

const listQuery = `r.id, r.display_name, r.email, r.relationship, r.status, r.created_at,
  r.revoked_at, r.linked_user_id IS NOT NULL AS accepted,
  COALESCE(p.categories, '{}') AS granted_categories,
  (SELECT max(expires_at) FROM recipient_invitations i
    WHERE i.recipient_id = r.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL) AS invite_expires_at`;

const listJoin = `LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT perm.category) AS categories
      FROM recipient_permissions perm WHERE perm.recipient_id = r.id
  ) p ON TRUE`;

/** GET /api/recipients — list recipients with their granted categories. */
export const GET = handleRoute(async () => {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);
  const rows = await db.q<Record<string, unknown>>(
    `SELECT ${listQuery} FROM recipients r ${listJoin} WHERE r.vault_id = $1 ORDER BY r.created_at DESC`,
    [vaultId],
  );
  return ok({ items: rows, total: rows.length });
});

/** POST /api/recipients — invite a recipient (sends a real email). */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  await assertRecipientQuota(ctx.user.id);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, createSchema);

  const limit = await rateLimit({
    key: limiterKey(["recipients:invite", ctx.user.id]),
    limit: 30,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    throw new ApiError(429, "rate_limited", "Too many invitations in one hour. Try again later.");
  }

  const vaultId = await vaultIdOf(ctx.user.id);

  const existing = await db.q1<{ id: string; status: string }>(
    `SELECT id, status FROM recipients WHERE vault_id = $1 AND email = $2`,
    [vaultId, body.email],
  );
  if (existing && existing.status !== "revoked") {
    throw new ApiError(409, "already_invited", "That person is already one of your recipients.");
  }

  const recipient = await db.q1<{ id: string }>(
    existing
      ? `UPDATE recipients SET display_name = $2, relationship = $3, status = 'invited', revoked_at = NULL
           WHERE id = $1 RETURNING id`
      : `INSERT INTO recipients (vault_id, display_name, email, relationship, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    existing
      ? [existing.id, body.displayName, body.relationship ?? null]
      : [vaultId, body.displayName, body.email, body.relationship ?? null, ctx.user.id],
  );
  if (!recipient) throw new ApiError(500, "create_failed", "We could not add that recipient.");

  // Explicit permission grants (revoke-all then grant keeps state deterministic).
  await db.raw(`DELETE FROM recipient_permissions WHERE recipient_id = $1`, [recipient.id]);
  for (const category of body.permissions ?? []) {
    await db.raw(
      `INSERT INTO recipient_permissions (recipient_id, vault_id, category) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
      [recipient.id, vaultId, category],
    );
  }

  const raw = randomToken(32);
  await db.raw(
    `INSERT INTO recipient_invitations (recipient_id, vault_id, email, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + interval '14 days', $5)`,
    [recipient.id, vaultId, body.email, sha256Hex(raw), ctx.user.id],
  );

  await queueEmail({
    to: body.email,
    template: "recipient_invitation",
    rendered: renderEmail("recipient_invitation", {
      senderName: ctx.user.fullName ?? ctx.user.email,
      url: appUrl(`/invite/${raw}`),
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toDateString(),
    }),
    userId: ctx.user.id,
    relatedType: "recipient",
    relatedId: recipient.id,
    dedupeKey: `invite:${recipient.id}:${Math.floor(Date.now() / 86_400_000)}`,
  });

  await recordAudit({
    action: "vault.recipient_invited",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "recipient",
    targetId: recipient.id,
    metadata: { invitee: body.email, permissions: body.permissions ?? [] },
  });

  const item = await db.q1<Record<string, unknown>>(
    `SELECT ${listQuery} FROM recipients r ${listJoin} WHERE r.id = $1`,
    [recipient.id],
  );
  return created({ item });
});
