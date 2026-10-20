import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, requireUser } from "@/lib/auth/guards";
import { listSessions, revokeAllSessions, revokeSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/security/audit";

export const GET = handleRoute(async () => {
  const ctx = await requireUser();
  const sessions = await listSessions(ctx.user.id);
  const devices = await db.q(
    `SELECT id, device_name, trusted_at, last_used_at, revoked_at
       FROM trusted_devices WHERE user_id = $1 ORDER BY last_used_at DESC LIMIT 50`,
    [ctx.user.id],
  );
  return ok({
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent,
      revokedAt: s.revokedAt,
      current: s.id === ctx.session.id,
    })),
    devices,
    currentSessionId: ctx.session.id,
  });
});

const deleteSchema = z
  .object({
    sessionId: z.string().optional(),
    all: z.boolean().optional(),
    deviceId: z.string().optional(),
  })
  .refine((v) => Boolean(v.sessionId || v.all || v.deviceId), { message: "Nothing to revoke." });

export const DELETE = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const body = await readJson(req, deleteSchema);

  if (body.deviceId) {
    const res = await db.raw(
      `UPDATE trusted_devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [body.deviceId, ctx.user.id],
    );
    if (!res.rowCount) return fail(404, "not_found", "Device not found.");
    await recordAudit({
      action: "account.device_revoked",
      actorType: "user",
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      targetType: "trusted_device",
      targetId: body.deviceId,
    });
    return ok({ ok: true, revoked: 1 });
  }

  if (body.all) {
    const count = await revokeAllSessions(ctx.user.id);
    await recordAudit({
      action: "account.sessions_revoked_all",
      actorType: "user",
      actorId: ctx.user.id,
      actorLabel: ctx.user.email,
      metadata: { count },
    });
    const { clearSessionCookie } = await import("@/lib/auth/guards");
    await clearSessionCookie();
    return ok({ ok: true, revoked: count });
  }

  const target = body.sessionId!;
  const owned = await db.q1(
    `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
    [target, ctx.user.id],
  );
  if (!owned) return fail(404, "not_found", "Session not found.");

  await revokeSession(target);
  await recordAudit({
    action: "account.session_revoked",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    targetType: "session",
    targetId: target,
  });
  const isCurrent = target === ctx.session.id;
  if (isCurrent) {
    const { clearSessionCookie } = await import("@/lib/auth/guards");
    await clearSessionCookie();
  }
  return ok({ ok: true, revoked: 1, signedOut: isCurrent });
});

export const runtime = "nodejs";
