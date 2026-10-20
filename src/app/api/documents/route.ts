import { assertRecordQuota } from "@/lib/billing/entitlements";
import crypto from "crypto";
import { ApiError, created, handleRoute, ok } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser, requireVerified } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";
import { vaultIdOf } from "@/lib/vault/modules";
import { getVaultDek } from "@/lib/vault/service";
import { encryptBuffer } from "@/lib/crypto/encryption";
import { getStorage, newDocumentKey } from "@/lib/storage/storage";

/**
 * Documents: private, encrypted file storage.
 *
 * Upload is multipart/form-data. Bytes are sealed with the vault DEK
 * (AES-256-GCM) BEFORE they reach storage, the checksum recorded is of the
 * plaintext, and every query is scoped to the caller's own vault. Downloads
 * go through an authorized endpoint — there are no public object URLs.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "video/mp4",
]);

const LIST_COLUMNS = `id, title, category, filename, mime_type, size_bytes, checksum_sha256,
  scan_status, tags, uploaded_at, updated_at, archived_at, deleted_at`;

/** GET /api/documents — list documents in the caller's vault. */
export const GET = handleRoute(async (req) => {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);
  const url = new URL(req.url);
  const params: unknown[] = [vaultId];
  const where = ["vault_id = $1", "deleted_at IS NULL"];

  const q = url.searchParams.get("q");
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(title) LIKE $${params.length} OR lower(filename) LIKE $${params.length})`);
  }
  const category = url.searchParams.get("category");
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (url.searchParams.get("archived") !== "1") where.push("archived_at IS NULL");

  const rows = await db.q<Record<string, unknown>>(
    `SELECT ${LIST_COLUMNS} FROM documents WHERE ${where.join(" AND ")}
      ORDER BY uploaded_at DESC LIMIT 400`,
    params,
  );
  const total = await db.q1<{ n: number }>(
    `SELECT count(*)::int AS n FROM documents WHERE vault_id = $1 AND deleted_at IS NULL`,
    [vaultId],
  );
  return ok({ items: rows, total: total?.n ?? rows.length });
});

/** POST /api/documents — upload one file (multipart). */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  await assertRecordQuota(ctx.user.id);
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({
    key: limiterKey(["documents:upload", ctx.user.id]),
    limit: 40,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    throw new ApiError(429, "rate_limited", "Too many uploads this hour. Please try again later.");
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw new ApiError(415, "unsupported_media", "Upload must be multipart/form-data.");
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ApiError(400, "file_required", "Choose a file to upload.");
  }
  if (file.size === 0) throw new ApiError(400, "file_empty", "That file is empty.");
  if (file.size > MAX_BYTES) {
    throw new ApiError(413, "file_too_large", "Files must be 25 MB or smaller.");
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    throw new ApiError(415, "file_type_rejected", "That file type isn't allowed. Use PDF, images, documents, CSV, text or MP4.");
  }

  const title = String(form.get("title") ?? "").trim().slice(0, 200) || file.name.slice(0, 200);
  const category = String(form.get("category") ?? "other").slice(0, 20);
  const tagsRaw = String(form.get("tags") ?? "");
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim().toLowerCase().slice(0, 32))
    .filter(Boolean)
    .slice(0, 10);
  const notes = String(form.get("notes") ?? "").trim().slice(0, 2000);

  if (!["financial", "property", "identity", "legal", "medical", "memory", "export", "other"].includes(category)) {
    throw new ApiError(400, "invalid_category", "Choose a valid document category.");
  }

  const vaultId = await vaultIdOf(ctx.user.id);
  const dek = await getVaultDek(vaultId);

  const plaintext = Buffer.from(await file.arrayBuffer());
  const checksum = crypto.createHash("sha256").update(plaintext).digest("hex");
  const sealed = encryptBuffer(plaintext, dek, `documents:content`);
  plaintext.fill(0);

  const documentId = crypto.randomUUID();
  const storageKey = newDocumentKey(vaultId, documentId);

  await getStorage().put(storageKey, sealed.ciphertext);

  try {
    const row = await db.q1<{ id: string }>(
      `INSERT INTO documents
         (id, vault_id, title, category, notes, tags, filename, mime_type, size_bytes,
          checksum_sha256, storage_key, enc_iv, enc_tag, scan_status, scan_detail, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        documentId,
        vaultId,
        title,
        category,
        notes || null,
        tags,
        file.name.slice(0, 255),
        file.type || "application/octet-stream",
        file.size,
        checksum,
        storageKey,
        sealed.iv,
        sealed.tag,
        "skipped",
        "stored encrypted; malware scan not configured",
        ctx.user.id,
      ],
    );
    if (!row) throw new ApiError(500, "upload_failed", "We could not save that document.");
  } catch (err) {
    // Fail clean: never leave orphaned ciphertext behind.
    await getStorage().delete(storageKey).catch(() => undefined);
    throw err;
  }

  await recordAudit({
    action: "vault.document_uploaded",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "document",
    targetId: documentId,
    metadata: { title, category, bytes: file.size },
  });

  const item = await db.q1<Record<string, unknown>>(
    `SELECT ${LIST_COLUMNS} FROM documents WHERE id = $1`,
    [documentId],
  );
  return created({ item });
});

export const runtime = "nodejs";
