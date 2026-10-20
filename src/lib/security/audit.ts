import { db, type Queryable } from "../db";
import { hmacHex } from "../crypto/encryption";

/**
 * Append-only security audit log. The table itself blocks UPDATE/DELETE via a
 * database trigger; this module only ever inserts, and never records private
 * vault content, credentials or tokens.
 */

export type ActorType = "user" | "admin" | "recipient" | "system";

export interface AuditInput {
  action: string;
  actorType: ActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_METADATA = /(password|token|secret|phrase|mnemonic|ciphertext|content|body|cookie|authorization)/i;

function sanitizeMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_METADATA.test(k)) continue;
    if (typeof v === "string" && v.length > 500) {
      out[k] = v.slice(0, 500) + "…";
    } else if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      out[k] = JSON.parse(JSON.stringify(v));
    } else {
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
  }
  return out;
}

export async function recordAudit(input: AuditInput, exec: Queryable = db): Promise<void> {
  const ipHash = input.ip ? hmacHex(input.ip).slice(0, 32) : null;
  const ua = input.userAgent ? input.userAgent.slice(0, 300) : null;
  try {
    await exec.q(
      `INSERT INTO audit_events (actor_type, actor_id, actor_label, action, target_type, target_id, ip_hash, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        input.actorType,
        input.actorId ?? null,
        input.actorLabel ?? null,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        ipHash,
        ua,
        JSON.stringify(sanitizeMetadata(input.metadata)),
      ],
    );
  } catch (err) {
    // Auditing must never break the primary flow silently: surface loudly.
    // (Failures are visible in logs and in /api/ready degraded status.)
    const message = err instanceof Error ? err.message : "unknown";
    console.error(JSON.stringify({ level: "error", msg: "audit_write_failed", action: input.action, error: message }));
    throw err;
  }
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  targetId?: string;
  sinceIso?: string;
  limit?: number;
}

export async function queryAudit(query: AuditQuery): Promise<Record<string, unknown>[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (query.action) {
    params.push(query.action);
    conditions.push(`action = $${params.length}`);
  }
  if (query.actorId) {
    params.push(query.actorId);
    conditions.push(`actor_id = $${params.length}`);
  }
  if (query.targetId) {
    params.push(query.targetId);
    conditions.push(`target_id = $${params.length}`);
  }
  if (query.sinceIso) {
    params.push(query.sinceIso);
    conditions.push(`occurred_at >= $${params.length}::timestamptz`);
  }
  params.push(Math.min(query.limit ?? 50, 200));
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.q(
    `SELECT id, actor_type, actor_id, actor_label, action, target_type, target_id, metadata, occurred_at
       FROM audit_events ${where}
      ORDER BY occurred_at DESC
      LIMIT $${params.length}`,
    params,
  );
}
