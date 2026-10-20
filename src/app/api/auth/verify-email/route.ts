import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin } from "@/lib/auth/guards";
import { consumeToken } from "@/lib/auth/tokens";
import { withTransaction } from "@/lib/db";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";

const schema = z.object({ token: z.string().min(10).max(400) });

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const body = await readJson(req, schema);

  const result = await withTransaction(async (tx) => {
    const consumed = await consumeToken(tx, body.token, "email_verify");
    if (!consumed) return { ok: false as const };

    const user = await tx.q1<{ id: string; email: string; status: string; emailVerifiedAt: Date | null }>(
      `SELECT id, email, status, email_verified_at FROM users WHERE id = $1 FOR UPDATE`,
      [consumed.userId],
    );
    if (!user || user.status === "deleted") return { ok: false as const };

    if (!user.emailVerifiedAt) {
      await tx.raw(`UPDATE users SET email_verified_at = now(), status = CASE WHEN status = 'unverified' THEN 'active' ELSE status END WHERE id = $1`, [
        user.id,
      ]);
      await queueEmail(
        {
          to: user.email,
          template: "welcome",
          rendered: renderEmail("welcome", { name: "", url: appUrl("/onboarding") }),
          userId: user.id,
          dedupeKey: `welcome-verified:${user.id}`,
        },
        tx,
      );
    }
    await recordAudit(
      { action: "auth.email_verified", actorType: "user", actorId: user.id, actorLabel: user.email },
      tx,
    );
    return { ok: true as const, alreadyVerified: Boolean(user.emailVerifiedAt) };
  });

  if (!result.ok) {
    return fail(400, "invalid_token", "This confirmation link is invalid or has expired. Request a new one from your account.");
  }
  return ok({ verified: true, alreadyVerified: result.alreadyVerified });
});

export const runtime = "nodejs";
