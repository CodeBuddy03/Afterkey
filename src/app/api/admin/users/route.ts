import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireAdmin } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { db } from "@/lib/db";

/**
 * Admin user management: list accounts and suspend/activate them.
 * Suspension revokes every session immediately. Admin only.
 */

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["suspend", "activate"]),
});

/** GET /api/admin/users?status=&q= */
export const GET = handleRoute(async (req) => {
  const ctx = await requireAdmin();
  const url = new URL(req.url);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];
  const status = url.searchParams.get("status");
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  const q = url.searchParams.get("q");
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(email) LIKE $${params.length} OR lower(COALESCE(full_name, '')) LIKE $${params.length})`);
  }
  params.push(200);

  const rows = await db.q<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    status: string;
    emailVerifiedAt: Date | null;
    mfaEnabled: boolean;
    createdAt: Date;
    vaultId: string | null;
    activeSessions: number;
  }>(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.email_verified_at, u.mfa_enabled, u.created_at,
            v.id AS vault_id,
            (SELECT count(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL)::int AS active_sessions
       FROM users u
       LEFT JOIN vaults v ON v.user_id = u.id
      WHERE ${where.join(" AND ")}
      ORDER BY u.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return ok({ items: rows, total: rows.length, requestedBy: ctx.user.id });
});

/** PATCH /api/admin/users — suspend or activate an account. */
export const PATCH = handleRoute(async (req) => {
  const ctx = await requireAdmin();
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, patchSchema);

  if (body.id === ctx.user.id) {
    throw new ApiError(400, "invalid_action", "You cannot suspend or activate your own account here.");
  }
  const target = await db.q1<{ id: string; status: string; email: string }>(
    `SELECT id, status, email FROM users WHERE id = $1`,
    [body.id],
  );
  if (!target) throw new ApiError(404, "not_found", "That account does not exist.");

  const nextStatus = body.action === "suspend" ? "suspended" : target.status === "suspended" ? "unverified" : target.status;
  if (nextStatus === target.status) {
    return ok({ id: target.id, status: target.status, changed: false });
  }

  await db.raw(`UPDATE users SET status = $2 WHERE id = $1`, [target.id, nextStatus]);
  let revoked = 0;
  if (body.action === "suspend") {
    const res = await db.raw(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [target.id],
    );
    revoked = res.rowCount ?? 0;
  }

  await recordAudit({
    action: body.action === "suspend" ? "admin.user_suspended" : "admin.user_activated",
    actorType: "admin",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "user",
    targetId: target.id,
    metadata: { email: target.email, previousStatus: target.status, newStatus: nextStatus, revokedSessions: revoked },
  });

  return ok({ id: target.id, status: nextStatus, changed: true, revokedSessions: revoked });
});

export const runtime = "nodejs";
