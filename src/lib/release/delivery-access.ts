import { ApiError } from "@/lib/api/http";
import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto/encryption";

/**
 * Recipient delivery access: resolves the single-purpose, hashed, expiring
 * token from a release_ready email to exactly one delivery. No session is
 * required (the recipient may not have an account) and the token can never
 * reach anything outside its stored package.
 */

export interface DeliveryContext {
  deliveryId: string;
  caseId: string;
  vaultId: string;
  recipientId: string;
  ownerName: string | null;
  packageItems: Array<{ id: string; type: string; title: string }>;
  availableAt: Date | null;
}

/** Resolve a raw delivery_access token to its delivery, or throw 404. */
export async function resolveDeliveryToken(token: string): Promise<DeliveryContext> {
  const row = await db.q1<{
    deliveryId: string;
    caseId: string;
    vaultId: string;
    recipientId: string;
    ownerName: string | null;
    pkg: DeliveryContext["packageItems"] | null;
    availableAt: Date | null;
  }>(
    `SELECT d.id AS delivery_id, d.case_id, d.vault_id, d.recipient_id, d.package AS pkg, d.available_at,
            u.full_name AS owner_name
       FROM email_tokens t
       JOIN release_deliveries d ON d.id = (t.meta->>'deliveryId')::uuid
       JOIN release_cases c ON c.id = d.case_id
       JOIN checkin_schedules s ON s.id = c.schedule_id
       LEFT JOIN users u ON u.id = s.user_id
      WHERE t.token_hash = $1
        AND t.purpose = 'delivery_access'
        AND t.consumed_at IS NULL
        AND t.expires_at > now()
        AND d.status IN ('available', 'viewed')`,
    [sha256Hex(token)],
  );
  if (!row) {
    throw new ApiError(404, "not_found", "This delivery link is invalid, used, or has expired.");
  }
  return {
    deliveryId: row.deliveryId,
    caseId: row.caseId,
    vaultId: row.vaultId,
    recipientId: row.recipientId,
    ownerName: row.ownerName,
    packageItems: Array.isArray(row.pkg) ? row.pkg : [],
    availableAt: row.availableAt,
  };
}
