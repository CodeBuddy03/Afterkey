import { db, type Queryable } from "../db";
import { env } from "../env";
import { hmacHex } from "../crypto/encryption";
import { nowMs } from "../clock";
import { log } from "../logger";

/**
 * Durable, database-backed fixed-window rate limiting. Works across processes
 * (web + worker) because all state lives in Postgres.
 */

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/** Pseudonymize identifying parts so buckets never store raw emails or IPs. */
export function limiterKey(parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ? hmacHex(p).slice(0, 16) : "-")).join(":");
}

export async function rateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
  exec?: Queryable;
}): Promise<RateLimitResult> {
  const exec = opts.exec ?? db;
  const windowMs = opts.windowSeconds * 1000;
  const startMs = Math.floor(nowMs() / windowMs) * windowMs;
  const windowStart = new Date(startMs);
  const expiresAt = new Date(startMs + windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - nowMs()) / 1000));

  try {
    const row = await exec.q1<{ count: number }>(
      `INSERT INTO rate_limits (bucket, window_start, count, expires_at)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (bucket, window_start)
       DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [opts.key, windowStart, expiresAt],
    );
    const count = row?.count ?? 1;

    // Opportunistic cleanup of expired buckets (cheap, ~1% of calls).
    if (Math.random() < 0.01) {
      await exec.raw(`DELETE FROM rate_limits WHERE expires_at < now()`);
    }

    return {
      ok: count <= opts.limit,
      limit: opts.limit,
      remaining: Math.max(0, opts.limit - count),
      retryAfterSeconds,
    };
  } catch (err) {
    // Fail closed for authentication-sensitive limiters: if the limiter table is
    // unreachable, the caller's transaction will fail anyway; for read paths we
    // log and allow.
    log.error("rate_limit_error", { error: err instanceof Error ? err.message : "unknown", key: opts.key });
    return { ok: false, limit: opts.limit, remaining: 0, retryAfterSeconds };
  }
}

export async function clearRateLimit(key: string, exec: Queryable = db): Promise<void> {
  await exec.raw(`DELETE FROM rate_limits WHERE bucket = $1`, [key]);
}

/** Convenience wrapper for rate-limiting a mutating API call per IP+route. */
export async function limitByIp(ip: string | null, route: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  return rateLimit({ key: limiterKey([route, ip ?? "local"]), limit, windowSeconds });
}

/** Production default request throttling for auth endpoints. */
export const AUTH_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  recovery: { limit: 5, windowSeconds: 3600 },
  reauth: { limit: 10, windowSeconds: 300 },
  mfa: { limit: 10, windowSeconds: 300 },
};

/** True when test route mode is on and limits can be relaxed for the e2e suite. */
export function limitsRelaxed(): boolean {
  return env().AFTERKEY_ENABLE_TEST_ROUTES === true;
}
