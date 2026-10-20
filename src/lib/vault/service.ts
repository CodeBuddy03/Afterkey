import { db, withTransaction, type Queryable, type Tx } from "../db";
import { generateDek, getMasterKey, unwrapKey, wrapKey } from "../crypto/encryption";
import { ApiError } from "../api/http";

/**
 * Vault provisioning and data-key access.
 *
 * Every user owns exactly one vault. All vault modules hang off vault_id and
 * every query in this codebase verifies ownership through the vault.
 */

export interface VaultRow {
  id: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export const VAULT_SELECT = `v.id, v.user_id, v.name, v.created_at, v.updated_at`;

export async function getVaultByUser(userId: string, exec: Queryable = db): Promise<VaultRow | null> {
  return exec.q1<VaultRow>(`SELECT ${VAULT_SELECT} FROM vaults v WHERE v.user_id = $1`, [userId]);
}

export async function getVaultById(vaultId: string, exec: Queryable = db): Promise<VaultRow | null> {
  return exec.q1<VaultRow>(`SELECT ${VAULT_SELECT} FROM vaults v WHERE v.id = $1`, [vaultId]);
}

/** Assert the vault belongs to the user; throws 404 (never 403) to avoid id probing. */
export async function requireOwnedVault(userId: string, vaultId: string, exec: Queryable = db): Promise<VaultRow> {
  const vault = await exec.q1<VaultRow>(
    `SELECT ${VAULT_SELECT} FROM vaults v WHERE v.id = $1 AND v.user_id = $2`,
    [vaultId, userId],
  );
  if (!vault) throw new ApiError(404, "not_found", "That item does not exist.");
  return vault;
}

/** Resolve the caller's vault id, asserting ownership of the given id. */
export async function resolveVaultId(userId: string, vaultId: string, exec: Queryable = db): Promise<string> {
  const vault = await requireOwnedVault(userId, vaultId, exec);
  return vault.id;
}

/**
 * Create a vault with its key material. Called inside the registration
 * transaction so no user can exist without a vault (or vice versa).
 */
export async function createVaultWithKeys(tx: Tx, userId: string, name = "My Vault"): Promise<VaultRow> {
  const vault = await tx.q1<VaultRow>(
    `INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING id, user_id, name, created_at, updated_at`,
    [userId, name],
  );
  if (!vault) throw new Error("Failed to create vault");

  const dek = generateDek();
  const wrapped = wrapKey(dek, getMasterKey());
  dek.fill(0);

  await tx.raw(`INSERT INTO vault_keys (vault_id, wrapped_dek) VALUES ($1, $2)`, [vault.id, wrapped]);

  await tx.raw(`INSERT INTO release_policies (vault_id) VALUES ($1)`, [vault.id]);
  const policy = await tx.q1<{ id: string }>(`SELECT id FROM release_policies WHERE vault_id = $1`, [vault.id]);

  await tx.raw(
    `INSERT INTO checkin_schedules (vault_id, user_id, policy_id, next_due_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [vault.id, userId, policy?.id ?? null],
  );
  await tx.raw(
    `INSERT INTO checkin_events (schedule_id, type, details, actor_type, actor_id)
     SELECT id, 'schedule_created', '{}'::jsonb, 'user', $2 FROM checkin_schedules WHERE vault_id = $1`,
    [vault.id, userId],
  );

  return vault;
}

/**
 * Decrypt the vault DEK using the server master key. This is the reason
 * AfterKey can perform automated, policy-verified release — and the reason it
 * must never claim zero-knowledge encryption (docs/security-architecture.md).
 */
export async function getVaultDek(vaultId: string, exec: Queryable = db): Promise<Buffer> {
  const row = await exec.q1<{ wrappedDek: string }>(`SELECT wrapped_dek FROM vault_keys WHERE vault_id = $1`, [vaultId]);
  if (!row) throw new ApiError(409, "vault_keys_missing", "Vault encryption keys are unavailable for this vault.");
  try {
    return unwrapKey(row.wrappedDek, getMasterKey());
  } catch {
    throw new ApiError(
      500,
      "vault_key_unavailable",
      "Vault key material could not be unwrapped. The application fails closed until this is resolved.",
    );
  }
}

export async function setRecoveryMaterial(
  tx: Tx,
  vaultId: string,
  wrapped: string,
  verifier: string,
): Promise<void> {
  const res = await tx.raw(
    `UPDATE vault_keys
        SET wrapped_dek_recovery = $2, recovery_verifier = $3,
            recovery_created_at = COALESCE(recovery_created_at, now()),
            recovery_rotated_at = now()
      WHERE vault_id = $1`,
    [vaultId, wrapped, verifier],
  );
  if (!res.rowCount) throw new ApiError(404, "not_found", "Vault not found.");
}

export async function getRecoveryStatus(
  vaultId: string,
  exec: Queryable = db,
): Promise<{ configured: boolean; createdAt: Date | null }> {
  const row = await exec.q1<{ recoveryVerifier: string | null; recoveryCreatedAt: Date | null }>(
    `SELECT recovery_verifier, recovery_created_at FROM vault_keys WHERE vault_id = $1`,
    [vaultId],
  );
  return { configured: Boolean(row?.recoveryVerifier), createdAt: row?.recoveryCreatedAt ?? null };
}

/**
 * Rotate the master key: re-wrap every vault DEK under the new key.
 * Run as a maintenance command (docs/backup-recovery.md §Key rotation).
 */
export async function rotateMasterKey(oldKeyB64: string, newKeyB64: string): Promise<{ rotated: number }> {
  const oldKey = Buffer.from(oldKeyB64, "base64");
  const newKey = Buffer.from(newKeyB64, "base64");
  if (oldKey.length !== 32 || newKey.length !== 32) throw new Error("Keys must be 32 bytes");

  return withTransaction(async (tx) => {
    const rows = await tx.q<{ vaultId: string; wrappedDek: string }>(
      `SELECT vault_id, wrapped_dek FROM vault_keys ORDER BY vault_id FOR UPDATE`,
    );
    let rotated = 0;
    for (const row of rows) {
      const dek = unwrapKey(row.wrappedDek, oldKey);
      const rewrapped = wrapKey(dek, newKey);
      dek.fill(0);
      await tx.raw(
        `UPDATE vault_keys SET wrapped_dek = $2, key_version = key_version + 1 WHERE vault_id = $1`,
        [row.vaultId, rewrapped],
      );
      rotated += 1;
    }
    return { rotated };
  });
}
