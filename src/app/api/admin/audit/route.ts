import { handleRoute, ok } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";

/**
 * Admin audit log: the full trail of security-relevant actions. Read-only by
 * design — audit rows are append-only in the database and nothing here can
 * rewrite them.
 */

/** GET /api/admin/audit?action=&actor=&targetType=&limit= */
export const GET = handleRoute(async (req) => {
  await requireAdmin();
  const url = new URL(req.url);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];

  const action = url.searchParams.get("action");
  if (action) {
    params.push(`${action}%`);
    where.push(`action LIKE $${params.length}`);
  }
  const actor = url.searchParams.get("actor");
  if (actor) {
    params.push(`%${actor.toLowerCase()}%`);
    where.push(`(lower(COALESCE(actor_label, '')) LIKE $${params.length} OR lower(COALESCE(actor_id::text, '')) LIKE $${params.length})`);
  }
  const targetType = url.searchParams.get("targetType");
  if (targetType) {
    params.push(targetType);
    where.push(`target_type = $${params.length}`);
  }
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  params.push(limit);

  const rows = await db.q<Record<string, unknown>>(
    `SELECT id, action, actor_type, actor_id, actor_label, ip_hash, target_type, target_id, metadata, occurred_at
       FROM audit_events
      WHERE ${where.join(" AND ")}
      ORDER BY occurred_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return ok({ items: rows, total: rows.length });
});

export const runtime = "nodejs";
