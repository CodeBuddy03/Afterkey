import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireRecentReauth, requireUser } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { decryptText, encryptText, getMasterKey, sha256Hex } from "@/lib/crypto/encryption";
import { recordAudit } from "@/lib/security/audit";
import { zPassword } from "@/lib/validation/common";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";

/**
 * TOTP multifactor authentication.
 *   POST   — generate a secret (shown once) for an authenticator app
 *   PATCH  — confirm a code: enables MFA and returns one-time backup codes
 *   DELETE — disable MFA (password + current code required)
 */

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  await req.json().catch(() => null); // body ignored; tolerates empty submissions

  if (ctx.user.mfaEnabled) {
    return fail(409, "already_enabled", "Multifactor authentication is already enabled. Disable it first to change devices.");
  }
  requireRecentReauth(ctx, 30);

  const { newTotpSecret, totpUri } = await import("@/lib/auth/totp");
  const secret = newTotpSecret();

  // Store the pending secret encrypted; it only becomes active on PATCH.
  await db.raw(`UPDATE users SET mfa_secret_enc = $2 WHERE id = $1`, [
    ctx.user.id,
    encryptText(secret, getMasterKey()),
  ]);

  const otpauth = totpUri(ctx.user.email, secret);
  await recordAudit({
    action: "account.mfa_setup_started",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
  });

  // The secret is shown exactly once, to the authenticated owner, over TLS.
  return ok({ secret, otpauth, issuer: "AfterKey" });
});

const enableSchema = z.object({ code: z.string().trim().min(6).max(8) });

export const PATCH = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, enableSchema);

  const limit = await rateLimit({ key: limiterKey(["mfa:enable", ctx.user.id]), limit: 10, windowSeconds: 900 });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again later.");

  const row = await db.q1<{ mfaSecretEnc: string | null }>(`SELECT mfa_secret_enc FROM users WHERE id = $1`, [
    ctx.user.id,
  ]);
  if (!row?.mfaSecretEnc) return fail(400, "setup_required", "Start MFA setup first.");

  const secret = decryptText(row.mfaSecretEnc, getMasterKey());
  if (!secret) return fail(500, "setup_error", "Could not read the pending MFA secret.");

  const { verifyTotp } = await import("@/lib/auth/totp");
  if (!verifyTotp(secret, body.code)) {
    return fail(400, "invalid_code", "That code is not correct. Check your authenticator app and try again.");
  }

  // One-time backup codes (stored hashed) so a lost phone cannot lock you out.
  const backupCodes = Array.from({ length: 10 }, () =>
    `${randomLower(4)}-${randomLower(4)}`,
  );
  const hashed = backupCodes.map((c) => sha256Hex(c.toLowerCase()));

  await db.raw(`UPDATE users SET mfa_enabled = TRUE, mfa_backup_codes = $2 WHERE id = $1`, [ctx.user.id, hashed]);
  await recordAudit({
    action: "account.mfa_enabled",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
  });
  await queueSecurityEmail(ctx.user.id, ctx.user.email, "multifactor authentication enabled");

  return ok({ enabled: true, backupCodes, message: "Store these backup codes somewhere safe — they are shown only once." });
});

const disableSchema = z.object({ password: zPassword(), code: z.string().trim().min(6).max(12) });

export const DELETE = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, disableSchema);

  const limit = await rateLimit({ key: limiterKey(["mfa:disable", ctx.user.id]), limit: 10, windowSeconds: 900 });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again later.");

  const row = await db.q1<{ passwordHash: string | null; mfaSecretEnc: string | null; mfaBackupCodes: string[] }>(
    `SELECT password_hash, mfa_secret_enc, mfa_backup_codes FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, body.password))) {
    return fail(401, "invalid_password", "Your password is not correct.");
  }

  let okCode = false;
  if (row.mfaSecretEnc) {
    try {
      const { verifyTotp } = await import("@/lib/auth/totp");
      const secret = decryptText(row.mfaSecretEnc, getMasterKey());
      if (secret) okCode = verifyTotp(secret, body.code);
    } catch {
      okCode = false;
    }
  }
  if (!okCode) {
    const hashed = sha256Hex(body.code.toLowerCase());
    if ((row.mfaBackupCodes ?? []).includes(hashed)) {
      okCode = true;
      await db.raw(`UPDATE users SET mfa_backup_codes = array_remove(mfa_backup_codes, $2) WHERE id = $1`, [
        ctx.user.id,
        hashed,
      ]);
    }
  }
  if (!okCode) return fail(400, "invalid_code", "That verification code is not correct.");

  await db.raw(
    `UPDATE users SET mfa_enabled = FALSE, mfa_secret_enc = NULL, mfa_backup_codes = '{}' WHERE id = $1`,
    [ctx.user.id],
  );
  await recordAudit({
    action: "account.mfa_disabled",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
  });
  await queueSecurityEmail(ctx.user.id, ctx.user.email, "multifactor authentication disabled");
  return ok({ enabled: false });
});

function randomLower(length: number): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

async function queueSecurityEmail(userId: string, email: string, event: string): Promise<void> {
  const { queueEmail } = await import("@/lib/email/outbox");
  const { renderEmail } = await import("@/lib/email/templates");
  const { appUrl } = await import("@/lib/urls");
  await queueEmail({
    to: email,
    template: "security_alert",
    rendered: renderEmail("security_alert", {
      event,
      time: new Date().toUTCString(),
      url: appUrl("/settings/security"),
    }),
    userId,
    dedupeKey: `semail:${userId}:${event}:${Math.floor(Date.now() / 600_000)}`,
  });
}

export const runtime = "nodejs";
