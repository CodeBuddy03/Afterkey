import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireAdmin } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { db } from "@/lib/db";

/** Admin support inbox: read contact-form submissions and move them along. */

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "open", "resolved", "closed"]),
});

/** GET /api/admin/support?status= */
export const GET = handleRoute(async (req) => {
  await requireAdmin();
  const url = new URL(req.url);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];
  const status = url.searchParams.get("status");
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  params.push(200);

  const rows = await db.q<Record<string, unknown>>(
    `SELECT id, name, email, subject, message, status, created_at, updated_at
       FROM support_requests
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return ok({ items: rows, total: rows.length });
});

/** PATCH /api/admin/support — update a request's status. */
export const PATCH = handleRoute(async (req) => {
  const ctx = await requireAdmin();
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, patchSchema);

  const res = await db.raw(`UPDATE support_requests SET status = $2 WHERE id = $1`, [body.id, body.status]);
  if (!res.rowCount) throw new ApiError(404, "not_found", "That request does not exist.");

  await recordAudit({
    action: "admin.support_updated",
    actorType: "admin",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "support_request",
    targetId: body.id,
    metadata: { status: body.status },
  });

  return ok({ id: body.id, status: body.status });
});

export const runtime = "nodejs";
