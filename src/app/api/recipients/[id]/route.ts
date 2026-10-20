import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { zId, zShortText } from "@/lib/validation/common";
import { db } from "@/lib/db";
import { vaultIdOf } from "@/lib/vault/modules";
import { PERMISSION_CATEGORIES } from "@/lib/vault/message-schemas";

const idSchema = z.object({ id: zId() });

const patchSchema = z.object({
  displayName: zShortText(120).optional(),
  relationship: zShortText(80).optional(),
  permissions: z.array(z.enum(PERMISSION_CATEGORIES)).max(5).optional(),
});

async function itemId(routeCtx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = idSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_id", "Invalid recipient identifier.");
  return parsed.data.id;
}

/** PATCH /api/recipients/[id] — rename or change granted categories. */
export const PATCH = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const body = await readJson(req, patchSchema);
  const vaultId = await vaultIdOf(ctx.user.id);

  const rec = await db.q1<{ id: string; status: string }>(
    `SELECT id, status FROM recipients WHERE id = $1 AND vault_id = $2`,
    [id, vaultId],
  );
  if (!rec) throw new ApiError(404, "not_found", "That recipient does not exist.");

  if (body.displayName !== undefined || body.relationship !== undefined) {
    await db.raw(
      `UPDATE recipients SET display_name = COALESCE($3, display_name),
                              relationship = COALESCE($4, relationship)
        WHERE id = $1 AND vault_id = $2`,
      [id, vaultId, body.displayName ?? null, body.relationship ?? null],
    );
  }

  if (body.permissions) {
    await db.raw(`DELETE FROM recipient_permissions WHERE recipient_id = $1`, [id]);
    for (const category of body.permissions) {
      await db.raw(
        `INSERT INTO recipient_permissions (recipient_id, vault_id, category) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
        [id, vaultId, category],
      );
    }
  }

  await recordAudit({
    action: "vault.recipient_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "recipient",
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });

  const item = await db.q1<Record<string, unknown>>(
    `SELECT r.id, r.display_name, r.email, r.relationship, r.status,
            COALESCE(array_agg(DISTINCT perm.category) FILTER (WHERE perm.category IS NOT NULL), '{}') AS granted_categories
       FROM recipients r
       LEFT JOIN recipient_permissions perm ON perm.recipient_id = r.id
      WHERE r.id = $1 AND r.vault_id = $2
      GROUP BY r.id`,
    [id, vaultId],
  );
  return ok({ item });
});

/** DELETE /api/recipients/[id] — immediate revocation (audited). */
export const DELETE = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const vaultId = await vaultIdOf(ctx.user.id);

  const res = await db.raw(
    `UPDATE recipients SET status = 'revoked', revoked_at = now()
      WHERE id = $1 AND vault_id = $2 AND status <> 'revoked'`,
    [id, vaultId],
  );
  if (!res.rowCount) throw new ApiError(404, "not_found", "That recipient does not exist or is already revoked.");

  await db.raw(`DELETE FROM recipient_permissions WHERE recipient_id = $1`, [id]);
  await db.raw(
    `UPDATE recipient_invitations SET revoked_at = now()
      WHERE recipient_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [id],
  );

  await recordAudit({
    action: "vault.recipient_revoked",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "recipient",
    targetId: id,
  });

  return ok({ id, status: "revoked" });
});
