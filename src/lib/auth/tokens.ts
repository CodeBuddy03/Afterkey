import type { Queryable } from "../db";
import { db } from "../db";
import { randomToken, sha256Hex } from "../crypto/encryption";

/**
 * Single-use, expiring, hashed tokens. Raw tokens exist only in transit
 * (email links, challenges); the database stores SHA-256 hashes.
 */

export type TokenPurpose =
  | "email_verify"
  | "password_reset"
  | "mfa_reset"
  | "mfa_challenge"
  | "release_otp"
  | "delivery_access"
  | "recovery_challenge";

export interface IssuedToken {
  raw: string;
  expiresAt: Date;
}

export async function issueToken(
  exec: Queryable,
  userId: string,
  purpose: TokenPurpose,
  ttlSeconds: number,
  meta: Record<string, unknown> = {},
  rawOverride?: string,
): Promise<IssuedToken> {
  const raw = rawOverride ?? randomToken(32);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await exec.q(
    `INSERT INTO email_tokens (user_id, purpose, token_hash, meta, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [userId, purpose, sha256Hex(raw), JSON.stringify(meta), expiresAt],
  );
  return { raw, expiresAt };
}

export interface ConsumedToken {
  id: string;
  userId: string;
  purpose: TokenPurpose;
  meta: Record<string, unknown>;
  expiresAt: Date;
}

/**
 * Atomically consume a token. Returns null when unknown, expired, already
 * used, or when the attempt counter is exhausted (brute-force protection).
 * Failed lookups still increment `attempts` for known hashes.
 */
export async function consumeToken(
  exec: Queryable,
  raw: string,
  purpose: TokenPurpose,
): Promise<ConsumedToken | null> {
  const tokenHash = sha256Hex(raw);
  const row = await exec.q1<{
    id: string;
    userId: string;
    purpose: TokenPurpose;
    meta: Record<string, unknown>;
    expiresAt: Date;
  }>(
    `UPDATE email_tokens
        SET consumed_at = now()
      WHERE token_hash = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > now()
        AND attempts < 5
      RETURNING id, user_id, purpose, meta, expires_at`,
    [tokenHash, purpose],
  );
  if (row) return row;

  // Record the failed attempt (if the hash exists and is unused/expired).
  await exec.raw(
    `UPDATE email_tokens
        SET attempts = attempts + 1
      WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [tokenHash, purpose],
  );
  return null;
}

export async function invalidateTokens(exec: Queryable, userId: string, purpose: TokenPurpose): Promise<void> {
  await exec.raw(
    `UPDATE email_tokens SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose],
  );
}

/** Housekeeping: drop long-expired tokens (called by the worker). */
export async function purgeExpiredTokens(exec: Queryable = db): Promise<number> {
  const res = await exec.raw(`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`);
  return res.rowCount ?? 0;
}
