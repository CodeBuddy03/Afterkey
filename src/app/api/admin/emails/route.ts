import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireAdmin } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";

/**
 * Admin email operations: inspect the outbox and retry failed sends.
 * Message bodies are never returned here — only metadata — so the outbox view
 * cannot become a content-disclosure channel.
 */

const retrySchema = z.object({ id: z.string().uuid() });

/** GET /api/admin/emails?status=&template=&to= */
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
  const template = url.searchParams.get("template");
  if (template) {
    params.push(template);
    where.push(`template = $${params.length}`);
  }
  const to = url.searchParams.get("to");
  if (to) {
    params.push(to.toLowerCase());
    where.push(`lower(to_email) = $${params.length}`);
  }
  params.push(200);

  const rows = await db.q<{
    id: string;
    toEmail: string;
    template: string;
    subject: string;
    status: string;
    provider: string | null;
    attempts: number;
    maxAttempts: number;
    errorCode: string | null;
    errorDetail: string | null;
    createdAt: Date;
  }>(
    `SELECT id, to_email, template, subject, status, provider, attempts, max_attempts,
            error_code, error_detail, created_at
       FROM email_messages
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return ok({ items: rows, total: rows.length });
});

/** POST /api/admin/emails — requeue one failed message. */
export const POST = handleRoute(async (req) => {
  const ctx = await requireAdmin();
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, retrySchema);

  const row = await db.q1<{ id: string; status: string; template: string; toEmail: string }>(
    `SELECT id, status, template, to_email FROM email_messages WHERE id = $1`,
    [body.id],
  );
  if (!row) throw new ApiError(404, "not_found", "That message does not exist.");
  if (!["failed", "bounced"].includes(row.status)) {
    throw new ApiError(400, "invalid_status", "Only failed or bounced messages can be retried.");
  }

  await db.raw(
    `UPDATE email_messages SET status = 'queued', attempts = 0, error_code = NULL, error_detail = NULL,
            updated_at = now() WHERE id = $1`,
    [row.id],
  );
  await enqueue({ type: "email.send", payload: { messageId: row.id }, idempotencyKey: `email:${row.id}:retry:${Date.now()}` });

  await recordAudit({
    action: "admin.email_retried",
    actorType: "admin",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "email_message",
    targetId: row.id,
    metadata: { template: row.template, to: row.toEmail },
  });

  return ok({ requeued: true, id: row.id });
});

export const runtime = "nodejs";
