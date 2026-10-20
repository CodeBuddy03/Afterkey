import { db, withTransaction, type Queryable } from "../db";
import { env } from "../env";
import { randomToken, sha256Hex } from "../crypto/encryption";
import { isProduction } from "../env";

/**
 * Database-backed sessions. Raw tokens are random 256-bit values shown only in
 * the HTTP-only cookie; the database stores only their SHA-256 hash.
 */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  role: "user" | "admin";
  status: "unverified" | "active" | "suspended" | "deletion_pending" | "deleted";
  emailVerifiedAt: Date | null;
  isSeedTestAccount: boolean;
  forcePasswordChange: boolean;
  mfaEnabled: boolean;
  timezone: string;
  locale: string;
  notificationPrefs: Record<string, boolean>;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  reauthAt: Date | null;
}

export interface AuthContext {
  user: AuthUser;
  session: SessionRecord;
}

export interface CreatedSession {
  token: string;
  session: SessionRecord;
}

function sessionTtlSeconds(): number {
  return Math.max(1, env().SESSION_TTL_DAYS) * 24 * 60 * 60;
}

export async function createSession(
  userId: string,
  opts: { ip?: string | null; userAgent?: string | null; reauth?: boolean } = {},
): Promise<CreatedSession> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + sessionTtlSeconds() * 1000);
  const ipHash = opts.ip ? sha256Hex(opts.ip + env().AFTERKEY_APP_SECRET).slice(0, 32) : null;
  const session = await withTransaction(async (tx) => {
    const row = await tx.q1<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip_hash, user_agent, reauth_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() ELSE NULL END)
       RETURNING id`,
      [userId, sha256Hex(token), expiresAt, ipHash, (opts.userAgent ?? "").slice(0, 400), opts.reauth === true],
    );
    if (!row) throw new Error("Failed to create session");
    return { id: row.id, userId, expiresAt, reauthAt: opts.reauth ? new Date() : null };
  });
  return { token, session };
}

const USER_COLUMNS = `u.id, u.email, u.full_name, u.role, u.status, u.email_verified_at,
  u.is_seed_test_account, u.force_password_change, u.mfa_enabled, u.timezone, u.locale,
  u.notification_prefs, u.created_at`;

/**
 * Rows arrive camelized by db.q1 (camelizeRow), so read camelCase keys here.
 * Reading snake_case would silently yield undefined/null for every multi-word
 * column — which would break email-verification gates, MFA flags and session ids.
 */
function mapUser(row: Record<string, unknown>): AuthUser {
  return {
    id: row.id as string,
    email: row.email as string,
    fullName: (row.fullName as string | null) ?? null,
    role: row.role as "user" | "admin",
    status: row.status as AuthUser["status"],
    emailVerifiedAt: (row.emailVerifiedAt as Date | null) ?? null,
    isSeedTestAccount: Boolean(row.isSeedTestAccount),
    forcePasswordChange: Boolean(row.forcePasswordChange),
    mfaEnabled: Boolean(row.mfaEnabled),
    timezone: row.timezone as string,
    locale: row.locale as string,
    notificationPrefs: (row.notificationPrefs as Record<string, boolean>) ?? {},
    createdAt: row.createdAt as Date,
  };
}

/**
 * Look up a session by raw token. Enforced here:
 *  - session not expired/revoked
 *  - user not deleted or suspended
 *  - seeded test accounts can never authenticate in production
 * Sliding expiry: sessions are extended when seen after 5+ minutes.
 */
export async function resolveSession(token: string): Promise<AuthContext | null> {
  const tokenHash = sha256Hex(token);
  const result = await withTransaction(async (tx) => {
    const row = await tx.q1<Record<string, unknown>>(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.reauth_at, s.last_seen_at, ${USER_COLUMNS}
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        FOR UPDATE OF s`,
      [tokenHash],
    );
    if (!row) return null;

    const user = mapUser(row);
    if (user.status === "deleted" || user.status === "suspended") return null;
    if (user.isSeedTestAccount && isProduction()) {
      // A seeded test account leaked into production: block authentication
      // until an administrator replaces it (see docs/production-checklist.md).
      return null;
    }

    const lastSeen = row.lastSeenAt as Date;
    const stale = Number.isFinite(new Date(lastSeen).getTime()) && Date.now() - new Date(lastSeen).getTime() > 5 * 60 * 1000;
    if (stale) {
      const newExpiry = new Date(Date.now() + sessionTtlSeconds() * 1000);
      await tx.raw(
        `UPDATE sessions SET last_seen_at = now(), expires_at = GREATEST(expires_at, $2)
          WHERE id = $1`,
        [row.sessionId as string, newExpiry],
      );
    }

    return {
      user,
      session: {
        id: row.sessionId as string,
        userId: row.userId as string,
        expiresAt: row.expiresAt as Date,
        reauthAt: (row.reauthAt as Date | null) ?? null,
      },
    };
  });
  return result;
}

export async function revokeSession(sessionId: string, exec: Queryable = db): Promise<void> {
  await exec.raw(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [sessionId]);
}

export async function revokeSessionByToken(token: string, exec: Queryable = db): Promise<void> {
  await exec.raw(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
    sha256Hex(token),
  ]);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string, exec: Queryable = db): Promise<number> {
  const res = await exec.raw(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
    [userId, exceptSessionId ?? null],
  );
  return res.rowCount ?? 0;
}

/** Mark the current session as recently reauthenticated (sensitive actions). */
export async function markReauth(sessionId: string, exec: Queryable = db): Promise<void> {
  await exec.raw(`UPDATE sessions SET reauth_at = now() WHERE id = $1`, [sessionId]);
}

export async function listSessions(userId: string): Promise<
  Array<{ id: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date; userAgent: string | null; revokedAt: Date | null }>
> {
  return db.q(
    `SELECT id, created_at, last_seen_at, expires_at, user_agent, revoked_at
       FROM sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 50`,
    [userId],
  );
}
