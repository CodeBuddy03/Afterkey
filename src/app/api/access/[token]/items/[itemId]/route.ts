import crypto from "crypto";
import { z } from "zod";
import { ApiError, handleRoute, ok } from "@/lib/api/http";
import { currentIpAndAgent } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { db } from "@/lib/db";
import { getVaultDek } from "@/lib/vault/service";
import { decryptBuffer, decryptMaybe, isEncrypted } from "@/lib/crypto/encryption";
import { getStorage } from "@/lib/storage/storage";
import { resolveDeliveryToken } from "@/lib/release/delivery-access";

/**
 * Content of one released item, for the token holder only.
 *
 * The item id must appear in the stored delivery package (intersection of the
 * recipient's grants and the policy's categories at execution time) — knowing
 * another item's id gains nothing. Text fields are decrypted with the vault
 * DEK here; documents stream through the same checksum-verified path as the
 * owner's downloads.
 */

const pathSchema = z.object({ token: z.string().trim().min(20).max(80), itemId: z.string().uuid() });

const DECRYPT_FIELDS: Record<string, string[]> = {
  financial: ["claim_instructions", "notes"],
  digital: ["recovery_instructions", "notes"],
  properties: ["emergency_instructions"],
};

/** GET /api/access/[token]/items/[itemId] */
export const GET = handleRoute(async (req, routeCtx) => {
  const { ip, userAgent } = await currentIpAndAgent();
  const parsed = pathSchema.safeParse(await routeCtx.params);
  if (!parsed.success) throw new ApiError(400, "invalid_token", "This delivery link is not valid.");

  const limit = await rateLimit({ key: limiterKey(["access:item", ip]), limit: 120, windowSeconds: 300 });
  if (!limit.ok) throw new ApiError(429, "rate_limited", "Too many requests. Please try again shortly.");

  const ctx = await resolveDeliveryToken(parsed.data.token);
  const item = ctx.packageItems.find((p) => p.id === parsed.data.itemId);
  if (!item) throw new ApiError(404, "not_found", "That item is not part of this delivery.");

  const dek = await getVaultDek(ctx.vaultId);
  try {
    if (item.type === "documents") {
      const doc = await db.q1<{
        id: string;
        filename: string;
        mimeType: string;
        storageKey: string;
        encIv: string;
        encTag: string;
        checksumSha256: string;
      }>(
        `SELECT id, filename, mime_type, storage_key, enc_iv, enc_tag, checksum_sha256
           FROM documents WHERE id = $1 AND vault_id = $2 AND deleted_at IS NULL`,
        [item.id, ctx.vaultId],
      );
      if (!doc) throw new ApiError(404, "not_found", "That document is no longer available.");

      const ciphertext = await getStorage().get(doc.storageKey);
      let plaintext: Buffer;
      try {
        plaintext = decryptBuffer(ciphertext, doc.encIv, doc.encTag, dek, "documents:content");
      } catch {
        throw new ApiError(500, "decrypt_failed", "This document could not be decrypted.");
      }
      const checksum = crypto.createHash("sha256").update(plaintext).digest("hex");
      if (checksum !== doc.checksumSha256) {
        throw new ApiError(500, "checksum_mismatch", "Document integrity check failed. It was not delivered.");
      }

      void recordAudit({
        action: "release.item_downloaded",
        actorType: "recipient",
        actorId: ctx.recipientId,
        ip,
        userAgent,
        targetType: "document",
        targetId: doc.id,
        metadata: { caseId: ctx.caseId, bytes: plaintext.length },
      });

      const safeName = doc.filename.replace(/["\\\r\n]/g, "_");
      return new Response(new Uint8Array(plaintext), {
        status: 200,
        headers: {
          "content-type": doc.mimeType || "application/octet-stream",
          "content-length": String(plaintext.length),
          "content-disposition": `attachment; filename="${safeName}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }

    // Structured items: fetch the row, decrypt the release-relevant fields.
    const table =
      item.type === "messages"
        ? "memories"
        : item.type === "financial"
          ? "financial_records"
          : item.type === "digital"
            ? "digital_accounts"
            : item.type === "properties"
              ? "properties"
              : null;
    if (!table) throw new ApiError(400, "invalid_item", "That item type cannot be delivered.");

    const row = await db.q1<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = $1 AND vault_id = $2`,
      [item.id, ctx.vaultId],
    );
    if (!row) throw new ApiError(404, "not_found", "That item is no longer available.");

    // Messages additionally require the consented release policy to still hold.
    if (item.type === "messages") {
      if (row.archivedAt || row.releasePolicy !== "on_release" || !row.consentAt) {
        throw new ApiError(404, "not_found", "That message is no longer part of this delivery.");
      }
    } else if (row.archivedAt) {
      throw new ApiError(404, "not_found", "That item is no longer available.");
    }

    const fields = item.type === "messages" ? ["body"] : (DECRYPT_FIELDS[item.type] ?? []);
    for (const f of fields) {
      const value = row[f];
      if (typeof value === "string" && isEncrypted(value)) {
        row[f] = decryptMaybe(value, dek) ?? "";
      }
    }

    void recordAudit({
      action: "release.item_viewed",
      actorType: "recipient",
      actorId: ctx.recipientId,
      ip,
      userAgent,
      targetType: item.type,
      targetId: item.id,
      metadata: { caseId: ctx.caseId },
    });

    return ok({ item: { type: item.type, title: item.title, content: row } }, { headers: { "cache-control": "private, no-store" } });
  } finally {
    dek.fill(0);
  }
});

export const runtime = "nodejs";
