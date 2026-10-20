import { z } from "zod";
import { created, fail, handleRoute, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent } from "@/lib/auth/guards";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { issueToken } from "@/lib/auth/tokens";
import { withTransaction } from "@/lib/db";
import { createVaultWithKeys } from "@/lib/vault/service";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { recordAudit } from "@/lib/security/audit";
import { issuesToDetails, zEmail, zPassword, zShortText } from "@/lib/validation/common";
import { AUTH_LIMITS, limitByIp } from "@/lib/security/rate-limit";

const schema = z.object({
  email: zEmail(),
  password: zPassword(),
  fullName: zShortText(120).optional(),
  timezone: z.string().trim().max(64).optional(),
});

/**
 * Registration. Anti-enumeration: the response is identical whether or not the
 * email already exists (a notice is mailed to the existing address instead).
 */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const limit = await limitByIp(ip, "auth:register", AUTH_LIMITS.register.limit, AUTH_LIMITS.register.windowSeconds);
  if (!limit.ok) {
    return fail(429, "rate_limited", `Too many sign-up attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`);
  }

  const body = await readJson(req, schema);

  const policy = checkPasswordPolicy(body.password);
  if (!policy.ok) return fail(400, "weak_password", "Please choose a stronger password.", issuesToDetails(policy.issues));

  // Hash first so duplicate and new accounts take similar time.
  const passwordHash = await hashPassword(body.password);

  const result = await withTransaction(async (tx) => {
    const existing = await tx.q1<{ id: string; email: string; fullName: string | null; status: string }>(
      `SELECT id, email, full_name, status FROM users WHERE email = $1`,
      [body.email],
    );
    if (existing) {
      if (existing.status !== "deleted") {
        await queueEmail(
          {
            to: existing.email,
            template: "security_alert",
            rendered: renderEmail("security_alert", {
              event: "sign-up attempt with your email address",
              time: new Date().toUTCString(),
              url: appUrl("/forgot-password"),
            }),
            userId: existing.id,
            dedupeKey: `signup-attempt:${existing.id}:${Math.floor(Date.now() / 600_000)}`,
          },
          tx,
        );
      }
      return { created: false as const };
    }

    const user = await tx.q1<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, timezone)
       VALUES ($1, $2, $3, COALESCE($4, 'Africa/Nairobi'))
       RETURNING id, email`,
      [body.email, passwordHash, body.fullName ?? null, body.timezone ?? null],
    );
    if (!user) throw new Error("Failed to create user");

    await createVaultWithKeys(tx, user.id);
    await tx.raw(`INSERT INTO subscriptions (user_id, plan_slug) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, [user.id]);

    const token = await issueToken(tx, user.id, "email_verify", 24 * 3600);
    await queueEmail(
      {
        to: user.email,
        template: "verify_email",
        rendered: renderEmail("verify_email", {
          name: body.fullName ?? "",
          url: appUrl(`/verify-email?token=${token.raw}`),
          expiresIn: "24 hours",
        }),
        userId: user.id,
        relatedType: "user",
        relatedId: user.id,
        dedupeKey: `verify:${user.id}:${Math.floor(Date.now() / 3_600_000)}`,
      },
      tx,
    );
    await queueEmail(
      {
        to: user.email,
        template: "welcome",
        rendered: renderEmail("welcome", { name: body.fullName ?? "", url: appUrl("/onboarding") }),
        userId: user.id,
        relatedType: "user",
        relatedId: user.id,
        dedupeKey: `welcome:${user.id}`,
      },
      tx,
    );

    await recordAudit(
      {
        action: "auth.registered",
        actorType: "user",
        actorId: user.id,
        actorLabel: user.email,
        ip,
        userAgent,
        metadata: { timezone: body.timezone ?? "Africa/Nairobi" },
      },
      tx,
    );

    return { created: true as const, email: user.email };
  });

  if (result.created) {
    return created({
      ok: true,
      email: result.email,
      message: "Your vault is ready. Check your inbox to confirm your email address.",
    });
  }
  return created({
    ok: true,
    email: body.email,
    message: "Check your inbox — if an account exists for this address, we have sent the next step.",
  });
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
