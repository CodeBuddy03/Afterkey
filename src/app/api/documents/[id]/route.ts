import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { zId } from "@/lib/validation/common";
import { db } from "@/lib/db";
import { vaultIdOf } from "@/lib/vault/modules";

/**
 * Single document: metadata edits and soft delete. Downloads live in
 * /api/documents/[id]/download (shared helper: @/lib/documents/download).
 */

const idSchema = z.object({ id: zId() });

async function itemId(routeCtx: { params: Promise<Record<string, string>> }): Promise<string> {
  const parsed = idSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_id", "Invalid document identifier.");
  return parsed.data.id;
}

const DOC_COLUMNS = `id, title, category, notes, tags, filename, mime_type, size_bytes,
  checksum_sha256, scan_status, uploaded_at, updated_at, archived_at`;

/** GET /api/documents/[id] — metadata only (never the bytes). */
export const GET = handleRoute(async (req, routeCtx) => {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);
  const id = await itemId(routeCtx);

  const row = await db.q1<Record<string, unknown>>(
    `SELECT ${DOC_COLUMNS} FROM documents WHERE id = $1 AND vault_id = $2 AND deleted_at IS NULL`,
    [id, vaultId],
  );
  if (!row) throw new ApiError(404, "not_found", "That document does not exist.");
  return ok({ item: row });
});

/** PATCH /api/documents/[id] — rename, recategorize, retag. */
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.enum(["financial", "property", "identity", "legal", "medical", "memory", "export", "other"]).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().max(32)).max(10).optional(),
});

export const PATCH = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const body = await readJson(req, patchSchema);
  const vaultId = await vaultIdOf(ctx.user.id);

  const sets: string[] = [];
  const vals: unknown[] = [id, vaultId];
  if (body.title !== undefined) { vals.push(body.title); sets.push(`title = $${vals.length}`); }
  if (body.category !== undefined) { vals.push(body.category); sets.push(`category = $${vals.length}`); }
  if (body.notes !== undefined) { vals.push(body.notes); sets.push(`notes = $${vals.length}`); }
  if (body.tags !== undefined) { vals.push(body.tags); sets.push(`tags = $${vals.length}`); }
  if (!sets.length) throw new ApiError(400, "nothing_to_update", "No changes were provided.");

  const row = await db.q1<{ id: string }>(
    `UPDATE documents SET ${sets.join(", ")} WHERE id = $1 AND vault_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    vals,
  );
  if (!row) throw new ApiError(404, "not_found", "That document does not exist.");

  await recordAudit({
    action: "vault.document_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "document",
    targetId: id,
    metadata: { fields: Object.keys(body) },
  });

  const item = await db.q1<Record<string, unknown>>(
    `SELECT ${DOC_COLUMNS} FROM documents WHERE id = $1`,
    [id],
  );
  return ok({ item });
});

/** DELETE /api/documents/[id] — soft delete (recoverable window, audited). */
export const DELETE = handleRoute(async (req, routeCtx) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const id = await itemId(routeCtx);
  const vaultId = await vaultIdOf(ctx.user.id);

  const res = await db.raw(
    `UPDATE documents SET deleted_at = now() WHERE id = $1 AND vault_id = $2 AND deleted_at IS NULL`,
    [id, vaultId],
  );
  if (!res.rowCount) throw new ApiError(404, "not_found", "That document does not exist.");

  await recordAudit({
    action: "vault.document_deleted",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "document",
    targetId: id,
  });
  return ok({ id, deleted: true });
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
