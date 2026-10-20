import crypto from "crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { db } from "@/lib/db";
import { vaultIdOf } from "@/lib/vault/modules";
import { getVaultDek } from "@/lib/vault/service";
import { decryptBuffer } from "@/lib/crypto/encryption";
import { getStorage } from "@/lib/storage/storage";

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Authorized document download: ownership check → storage read → decrypt with
 * vault DEK (AAD "documents:content", matching upload) → checksum verify →
 * stream. Never bypasses vault scoping; audit-logs every delivery.
 */
export async function downloadDocument(
  req: Request,
  routeCtx: { params: Promise<Record<string, string>> },
): Promise<Response> {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);
  const parsed = idSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_id", "Invalid document identifier.");
  const id = parsed.data.id;

  const row = await db.q1<{
    id: string;
    filename: string;
    mimeType: string;
    storageKey: string;
    encIv: string;
    encTag: string;
    checksumSha256: string;
    sizeBytes: number;
  }>(
    `SELECT id, filename, mime_type, storage_key, enc_iv, enc_tag, checksum_sha256, size_bytes
       FROM documents WHERE id = $1 AND vault_id = $2 AND deleted_at IS NULL`,
    [id, vaultId],
  );
  if (!row) throw new ApiError(404, "not_found", "That document does not exist.");

  const dek = await getVaultDek(vaultId);
  const ciphertext = await getStorage().get(row.storageKey);
  let plaintext: Buffer;
  try {
    plaintext = decryptBuffer(ciphertext, row.encIv, row.encTag, dek, "documents:content");
  } catch {
    throw new ApiError(
      500,
      "decrypt_failed",
      "This document could not be decrypted and was not delivered.",
    );
  }

  const checksum = crypto.createHash("sha256").update(plaintext).digest("hex");
  if (checksum !== row.checksumSha256) {
    throw new ApiError(
      500,
      "checksum_mismatch",
      "Document integrity check failed and was not delivered.",
    );
  }

  await recordAudit({
    action: "vault.document_downloaded",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
    targetType: "document",
    targetId: id,
    metadata: { bytes: row.sizeBytes },
  });

  const safeName = row.filename.replace(/["\\\r\n]/g, "_");
  return new Response(new Uint8Array(plaintext), {
    status: 200,
    headers: {
      "content-type": row.mimeType || "application/octet-stream",
      "content-length": String(plaintext.length),
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
