import { db } from "../db";
import { ApiError } from "../api/http";
import { decryptMaybe, encryptText, isEncrypted } from "../crypto/encryption";
import { getVaultDek } from "./service";

/**
 * Shared plumbing for the flat vault modules (financial records, digital
 * accounts, properties, legacy messages). Each module declares a spec below
 * and gets a fully authorized, encrypted CRUD API out of it.
 *
 * Authorization model: every query is scoped by vault_id resolved from the
 * authenticated user, so an id from another vault simply returns 404 — ids
 * can never be probed across accounts. Encrypted columns are sealed with the
 * vault DEK before writing and opened only after the ownership check passes.
 */

export interface ModuleSpec {
  /** Database table name. */
  table: string;
  /** Columns that hold encrypted text (sealed with the vault DEK). */
  encrypted: string[];
  /** Columns returned by list/detail queries, in display order. */
  columns: string[];
  /** Text column used for search (lowercased equality/LIKE). */
  searchColumn?: string;
  /** Column used for category filtering (defaults to `category`). */
  filterColumn?: string;
  /** Columns a PATCH may write (beyond updated_at). */
  writable: string[];
}

export interface ListOptions {
  q?: string;
  category?: string;
  includeArchived?: boolean;
  limit?: number;
}

/** List rows of a module, decrypted for the response, never crossing vaults. */
export async function listModule(
  spec: ModuleSpec,
  userId: string,
  opts: ListOptions = {},
): Promise<Record<string, unknown>[]> {
  const vaultId = await vaultIdOf(userId);
  const dek = await getVaultDek(vaultId);

  const where: string[] = ["vault_id = $1"];
  if (!opts.includeArchived) where.push("archived_at IS NULL");
  const params: unknown[] = [vaultId];

  if (opts.q && spec.searchColumn) {
    params.push(`%${opts.q.toLowerCase()}%`);
    where.push(`lower(${spec.searchColumn}) LIKE $${params.length}`);
  }
  if (opts.category) {
    params.push(opts.category);
    where.push(`${spec.filterColumn ?? "category"} = $${params.length}`);
  }

  params.push(Math.min(Math.max(opts.limit ?? 200, 1), 500));
  const rows = await db.q<Record<string, unknown>>(
    `SELECT ${spec.columns.join(", ")} FROM ${spec.table}
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((row) => decryptRow(spec, row, dek));
}

/** Fetch one row by id inside the caller's vault. */
export async function getModuleItem(
  spec: ModuleSpec,
  userId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const vaultId = await vaultIdOf(userId);
  const dek = await getVaultDek(vaultId);
  const row = await db.q1<Record<string, unknown>>(
    `SELECT ${spec.columns.join(", ")} FROM ${spec.table} WHERE id = $1 AND vault_id = $2`,
    [id, vaultId],
  );
  if (!row) throw new ApiError(404, "not_found", "That item does not exist.");
  return decryptRow(spec, row, dek);
}

/** Insert a row, sealing encrypted columns first. */
export async function createModule(
  spec: ModuleSpec,
  userId: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const vaultId = await vaultIdOf(userId);
  const dek = await getVaultDek(vaultId);

  const cols = ["vault_id"];
  const vals: unknown[] = [vaultId];
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined || !spec.writable.includes(key)) continue;
    cols.push(toColumn(key));
    vals.push(spec.encrypted.includes(key) ? encryptText(String(raw ?? ""), dek, `${spec.table}:${key}`) : raw);
  }
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const row = await db.q1<Record<string, unknown>>(
    `INSERT INTO ${spec.table} (${cols.join(", ")}) VALUES (${placeholders})
     RETURNING ${spec.columns.join(", ")}`,
    vals,
  );
  if (!row) throw new ApiError(500, "create_failed", "We could not save that item. Please try again.");
  return decryptRow(spec, row, dek);
}

/** Update a row inside the caller's vault, re-sealing encrypted columns. */
export async function updateModule(
  spec: ModuleSpec,
  userId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const vaultId = await vaultIdOf(userId);
  const dek = await getVaultDek(vaultId);

  const sets: string[] = [];
  const vals: unknown[] = [id, vaultId];
  for (const [key, raw] of Object.entries(values)) {
    if (raw === undefined || !spec.writable.includes(key)) continue;
    vals.push(spec.encrypted.includes(key) ? encryptText(String(raw ?? ""), dek, `${spec.table}:${key}`) : raw);
    sets.push(`${toColumn(key)} = $${vals.length}`);
  }
  if (!sets.length) {
    const existing = await getModuleItem(spec, userId, id);
    return existing;
  }
  const row = await db.q1<Record<string, unknown>>(
    `UPDATE ${spec.table} SET ${sets.join(", ")} WHERE id = $1 AND vault_id = $2
     RETURNING ${spec.columns.join(", ")}`,
    vals,
  );
  if (!row) throw new ApiError(404, "not_found", "That item does not exist.");
  return decryptRow(spec, row, dek);
}

/** Soft-archive (or restore) a row. Deletes never cross vault boundaries. */
export async function archiveModule(
  spec: ModuleSpec,
  userId: string,
  id: string,
  archived: boolean,
): Promise<{ id: string; archived: boolean }> {
  const vaultId = await vaultIdOf(userId);
  const res = await db.raw(
    `UPDATE ${spec.table} SET archived_at = ${archived ? "now()" : "NULL"}
      WHERE id = $1 AND vault_id = $2`,
    [id, vaultId],
  );
  if (!res.rowCount) throw new ApiError(404, "not_found", "That item does not exist.");
  return { id, archived };
}

/** camelCase API field name → snake_case column name. */
function toColumn(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Resolve the caller's own vault id. vaults.user_id is UNIQUE, so this is a
 * complete ownership check — no client-supplied vault id is ever trusted.
 */
export async function vaultIdOf(userId: string): Promise<string> {
  const row = await db.q1<{ id: string }>(`SELECT id FROM vaults WHERE user_id = $1`, [userId]);
  if (!row) throw new ApiError(404, "not_found", "Vault not found.");
  return row.id;
}

/** Decrypt every encrypted column present on the row for API responses. */
export function decryptRow(
  spec: ModuleSpec,
  row: Record<string, unknown>,
  dek: Buffer,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const col of spec.encrypted) {
    const value = out[col];
    if (typeof value === "string" && isEncrypted(value)) {
      // AAD must match encryption: `${spec.table}:${camelField}`.
      out[col] = decryptMaybe(value, dek, `${spec.table}:${col}`) ?? "";
    }
  }
  return out;
}
