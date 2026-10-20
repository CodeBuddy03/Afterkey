import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, clearSessionCookie, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { db, withTransaction } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { zPassword, zShortText } from "@/lib/validation/common";

const RETENTION_DAYS = 7;

const requestSchema = z.object({
  password: zPassword(),
  reason: zShortText(500).optional(),
  confirmText: z.literal("DELETE MY ACCOUNT"),
});

/**
 * Schedule account deletion (7-day grace, cancellable by signing in).
 * Revokes every session and invitation immediately; executes as a durable job.
 */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({ key: limiterKey(["account:delete", ctx.user.id]), limit: 5, windowSeconds: 3600 });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again later.");

  const body = await readJson(req, requestSchema);

  if (body.confirmText !== "DELETE MY ACCOUNT") {
    return fail(400, "confirmation_required", 'Type "DELETE MY ACCOUNT" exactly to confirm.', {
      confirmText: ["Type DELETE MY ACCOUNT in capitals to confirm."],
    });
  }

  const row = await db.q1<{ passwordHash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [
    ctx.user.id,
  ]);
  if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, body.password))) {
    await recordAudit({
      action: "account.deletion_attempt_failed",
      actorType: "user",
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      ip,
      userAgent,
    });
    return fail(401, "invalid_password", "Your password is not correct.");
  }

  const executeAfter = new Date(Date.now() + RETENTION_DAYS * 86_400_000);
  const result = await withTransaction(async (tx) => {
    const existing = await tx.q1<{ id: string; status: string }>(
      `SELECT id, status FROM data_deletion_requests WHERE user_id = $1 AND status IN ('requested', 'scheduled')`,
      [ctx.user.id],
    );
    if (existing) return { requestId: existing.id, alreadyScheduled: true };

    const request = await tx.q1<{ id: string }>(
      `INSERT INTO data_deletion_requests (user_id, status, reason, execute_after)
       VALUES ($1, 'scheduled', $2, $3) RETURNING id`,
      [ctx.user.id, body.reason ?? null, executeAfter],
    );
    if (!request) throw new Error("Could not create deletion request");

    // Revoke everything now: sessions, invitations, MFA challenges.
    await tx.raw(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [ctx.user.id]);
    await tx.raw(`UPDATE recipient_invitations SET revoked_at = now() WHERE created_by = $1 AND revoked_at IS NULL`, [
      ctx.user.id,
    ]);
    await tx.raw(`UPDATE email_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [ctx.user.id]);
    await tx.raw(`UPDATE users SET status = 'deletion_pending' WHERE id = $1`, [ctx.user.id]);

    await enqueue(
      {
        type: "account.deletion.execute",
        payload: { requestId: request.id },
        runAt: executeAfter,
        idempotencyKey: `deletion:${request.id}`,
      },
      tx,
    );

    await queueEmail(
      {
        to: ctx.user.email,
        template: "account_deletion_scheduled",
        rendered: renderEmail("account_deletion_scheduled", {
          executeAfterLabel: executeAfter.toUTCString(),
          url: appUrl("/signin"),
        }),
        userId: ctx.user.id,
        relatedType: "deletion_request",
        relatedId: request.id,
        dedupeKey: `deletion:${request.id}`,
      },
      tx,
    );

    await recordAudit(
      {
        action: "account.deletion_scheduled",
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.email,
        ip,
        userAgent,
        metadata: { requestId: request.id, executeAfter: executeAfter.toISOString(), reason: body.reason ?? null },
      },
      tx,
    );

    return { requestId: request.id, alreadyScheduled: false };
  });

  await clearSessionCookie();
  return ok({
    ok: true,
    requestId: result.requestId,
    alreadyScheduled: result.alreadyScheduled,
    executeAfter: executeAfter.toISOString(),
    message: `Your account is scheduled for deletion on ${executeAfter.toUTCString()}. Sign in before then to cancel.`,
  });
});

/** Cancel a pending deletion (the signed-in owner may still do so). */
export const DELETE = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const result = await withTransaction(async (tx) => {
    const request = await tx.q1<{ id: string }>(
      `SELECT id FROM data_deletion_requests
        WHERE user_id = $1 AND status IN ('requested', 'scheduled') FOR UPDATE`,
      [ctx.user.id],
    );
    if (!request) return { canceled: false };

    await tx.raw(`UPDATE data_deletion_requests SET status = 'canceled' WHERE id = $1`, [request.id]);
    await tx.raw(
      `UPDATE users SET status = CASE WHEN email_verified_at IS NOT NULL THEN 'active' ELSE 'unverified' END
        WHERE id = $1 AND status = 'deletion_pending'`,
      [ctx.user.id],
    );
    await recordAudit(
      {
        action: "account.deletion_canceled",
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.email,
        ip,
        userAgent,
        metadata: { requestId: request.id },
      },
      tx,
    );
    return { canceled: true };
  });

  if (!result.canceled) return fail(404, "not_found", "No pending deletion request was found.");
  return ok({ ok: true, message: "Account deletion cancelled. Welcome back." });
});

export const runtime = "nodejs";
