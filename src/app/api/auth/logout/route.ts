import { handleRoute, ok } from "@/lib/api/http";
import { assertSameOrigin, clearSessionCookie, getSessionToken } from "@/lib/auth/guards";
import { revokeSessionByToken } from "@/lib/auth/session";
import { recordAudit } from "@/lib/security/audit";

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const token = await getSessionToken();
  if (token) {
    const { resolveSession } = await import("@/lib/auth/session");
    const ctx = await resolveSession(token);
    await revokeSessionByToken(token);
    if (ctx) {
      await recordAudit({
        action: "auth.logout",
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.email,
      });
    }
  }
  await clearSessionCookie();
  return ok({ ok: true });
});

export const runtime = "nodejs";
