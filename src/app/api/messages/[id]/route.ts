import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { zId } from "@/lib/validation/common";
import { db } from "@/lib/db";
import { getVaultDek } from "@/lib/vault/service";
import { vaultIdOf } from "@/lib/vault/modules";
import { decryptMaybe, encryptText, isEncrypted } from "@/lib/crypto/encryption";
import { messagePatchSchema } from "@/lib/vault/message-schemas";

const idSchema = z.object({ id: zId() });

async function itemId(routeCtx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = idSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_id", "Invalid message identifier.");
  return parsed.data.id;
}

/** GET /api/messages/[id] */
export const GET = handleRoute(async (req, routeCtx) => {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);
  const dek = await getVaultDek(vaultId);
  const id = await itemId(routeCtx);

  const row = await db.q1<Record<string, unknown>>(
    `SELECT m.id, m.title, m.body, m.recipient_id, m.intended_label, m.relationship,
            m.release_policy, m.consent_at, m.status, m.scheduled_for, m.created_at, m.updated_at,
            r.display_name AS recipient_name
       FROM memories m
       LEFT JOIN recipients r ON r.id = m.recipient_id AND r.vault_id = m.vault_id
      WHERE m.id = $1 AND m.vault_id = $2`,
    [id, vaultId],
  );
  if (!row) throw new ApiError(404, "not_found", "That message does not exist.");
  if (typeof row.body === "string" && isEncrypted(row.body)) {
    row.body = decryptMaybe(row.body, dek, "memories:body") ?? "";
  }
  return ok({ item: row });
});

/** PATCH /api/messages/[id] */
export const PATCH = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const body = await readJson(req, messagePatchSchema);

  const vaultId = await vaultIdOf(ctx.user.id);
  const dek = await getVaultDek(vaultId);

  if (body.recipientId !== undefined && body.recipientId !== null) {
    const rec = await db.q1<{ id: string }>(
      `SELECT id FROM recipients WHERE id = $1 AND vault_id = $2 AND status <> 'revoked'`,
      [body.recipientId, vaultId],
    );
    if (!rec) throw new ApiError(400, "invalid_recipient", "Choose one of your active recipients.");
  }

  const sets: string[] = [];
  const vals: unknown[] = [id, vaultId];
  const colMap: Record<string, string> = {
    title: "title",
    body: "body",
    recipientId: "recipient_id",
    intendedLabel: "intended_label",
    relationship: "relationship",
    releasePolicy: "release_policy",
    status: "status",
    scheduledFor: "scheduled_for",
  };
  for (const [key, col] of Object.entries(colMap)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    vals.push(key === "body" && value ? encryptText(String(value), dek, "memories:body") : value);
    sets.push(`${col} = $${vals.length}`);
  }
  // Consent: explicit toggle wins; switching back to manual always withdraws it.
  if (body.consent !== undefined) {
    vals.push(body.consent ? new Date() : null);
    sets.push(`consent_at = $${vals.length}`);
  } else if (body.releasePolicy === "manual") {
    sets.push(`consent_at = NULL`);
  }
  if (!sets.length) throw new ApiError(400, "nothing_to_update", "No changes were provided.");

  const row = await db.q1<{ id: string }>(
    `UPDATE memories SET ${sets.join(", ")} WHERE id = $1 AND vault_id = $2 RETURNING id`,
    vals,
  );
  if (!row) throw new ApiError(404, "not_found", "That message does not exist.");

  await recordAudit({
    action: "vault.message_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "memory",
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });

  const item = await db.q1<Record<string, unknown>>(
    `SELECT id, title, body, recipient_id, intended_label, relationship, release_policy,
            consent_at, status, created_at, updated_at
       FROM memories WHERE id = $1 AND vault_id = $2`,
    [id, vaultId],
  );
  if (item && typeof item.body === "string" && isEncrypted(item.body)) {
    item.body = decryptMaybe(item.body, dek, "memories:body") ?? "";
  }
  return ok({ item });
});

/** DELETE /api/messages/[id] — soft archive (recoverable). */
export const DELETE = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const vaultId = await vaultIdOf(ctx.user.id);

  const res = await db.raw(
    `UPDATE memories SET archived_at = now() WHERE id = $1 AND vault_id = $2 AND archived_at IS NULL`,
    [id, vaultId],
  );
  if (!res.rowCount) throw new ApiError(404, "not_found", "That message does not exist.");

  await recordAudit({
    action: "vault.message_archived",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "memory",
    targetId: id,
  });
  return ok({ id, archived: true });
});

export const runtime = "nodejs";
