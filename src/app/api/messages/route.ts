import { assertRecordQuota } from "@/lib/billing/entitlements";
import { ApiError, created, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser, requireVerified } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { db } from "@/lib/db";
import { getVaultDek } from "@/lib/vault/service";
import { vaultIdOf } from "@/lib/vault/modules";
import { decryptMaybe, encryptText, isEncrypted } from "@/lib/crypto/encryption";
import { messageCreateSchema } from "@/lib/vault/message-schemas";

/**
 * Legacy messages (memories): letters and instructions for specific people.
 * Body is encrypted with the vault DEK; recipient links are validated to be
 * recipients of the same vault before any write.
 */

const MEMORY_COLUMNS = `m.id, m.title, m.body, m.recipient_id, m.intended_label, m.relationship,
  m.release_policy, m.consent_at, m.scheduled_for, m.status, m.created_at, m.updated_at, m.archived_at,
  r.display_name AS recipient_name, r.email AS recipient_email,
  COALESCE(md.count, 0)::int AS document_count`;

const MEMORY_JOIN = `FROM memories m
  LEFT JOIN recipients r ON r.id = m.recipient_id AND r.vault_id = m.vault_id
  LEFT JOIN (SELECT memory_id, count(*) AS count FROM memory_documents GROUP BY memory_id) md
    ON md.memory_id = m.id`;

function decryptMemory(row: Record<string, unknown>, dek: Buffer): Record<string, unknown> {
  const out = { ...row };
  if (typeof out.body === "string" && isEncrypted(out.body)) {
    out.body = decryptMaybe(out.body, dek, "memories:body") ?? "";
  }
  return out;
}

/** GET /api/messages — list legacy messages. */
export const GET = handleRoute(async (req) => {
  const ctx = await requireUser();
  const url = new URL(req.url);
  const vaultId = await vaultIdOf(ctx.user.id);
  const dek = await getVaultDek(vaultId);

  const where = ["m.vault_id = $1", "m.archived_at IS NULL"];
  const params: unknown[] = [vaultId];
  const q = url.searchParams.get("q");
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`lower(m.title) LIKE $${params.length}`);
  }

  const rows = await db.q<Record<string, unknown>>(
    `SELECT ${MEMORY_COLUMNS} ${MEMORY_JOIN}
      WHERE ${where.join(" AND ")}
      ORDER BY m.updated_at DESC LIMIT 300`,
    params,
  );
  return ok({ items: rows.map((r) => decryptMemory(r, dek)), total: rows.length });
});

/** POST /api/messages — create a legacy message. */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  await assertRecordQuota(ctx.user.id);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, messageCreateSchema);

  const vaultId = await vaultIdOf(ctx.user.id);
  if (body.recipientId) {
    const rec = await db.q1<{ id: string }>(
      `SELECT id FROM recipients WHERE id = $1 AND vault_id = $2 AND status <> 'revoked'`,
      [body.recipientId, vaultId],
    );
    if (!rec) throw new ApiError(400, "invalid_recipient", "Choose one of your active recipients.");
  }
  const dek = await getVaultDek(vaultId);

  // Consent is explicit and recorded: a message is only eligible for release
  // when the owner marked it on_release AND ticked consent in the same action.
  const consentAt = body.releasePolicy === "on_release" && body.consent ? new Date() : null;

  const row = await db.q1<{ id: string }>(
    `INSERT INTO memories (vault_id, title, body, recipient_id, intended_label, relationship,
                           release_policy, consent_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      vaultId,
      body.title,
      body.body ? encryptText(body.body, dek, "memories:body") : null,
      body.recipientId ?? null,
      body.intendedLabel ?? null,
      body.relationship ?? null,
      body.releasePolicy ?? "manual",
      consentAt,
      body.status === "archived" ? "draft" : body.status ?? "draft",
    ],
  );
  if (!row) throw new ApiError(500, "create_failed", "We could not save that message.");

  await recordAudit({
    action: "vault.message_created",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "memory",
    targetId: row.id,
    metadata: { title: body.title, releasePolicy: body.releasePolicy ?? "manual", consent: Boolean(consentAt) },
  });

  const item = await db.q1<Record<string, unknown>>(
    `SELECT ${MEMORY_COLUMNS} ${MEMORY_JOIN} WHERE m.id = $1`,
    [row.id],
  );
  return created({ item: item ? decryptMemory(item, dek) : null });
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
