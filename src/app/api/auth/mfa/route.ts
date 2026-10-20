import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, setSessionCookie, setDeviceCookie } from "@/lib/auth/guards";
import { consumeToken } from "@/lib/auth/tokens";
import { createSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { decryptText, getMasterKey, randomToken, sha256Hex } from "@/lib/crypto/encryption";
import { recordAudit } from "@/lib/security/audit";
import { AUTH_LIMITS, limiterKey, rateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  mfaToken: z.string().min(10).max(400),
  code: z.string().trim().min(6).max(12),
});

/** Complete a login that requires TOTP (or a one-time backup code). */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, schema);

  const limit = await rateLimit({
    key: limiterKey(["auth:mfa", ip ?? "local"]),
    limit: AUTH_LIMITS.mfa.limit,
    windowSeconds: AUTH_LIMITS.mfa.windowSeconds,
  });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");

  const consumed = await consumeToken(db, body.mfaToken, "mfa_challenge");
  if (!consumed) {
    return fail(401, "invalid_challenge", "This sign-in attempt expired. Please sign in again.");
  }

  const user = await db.q1<{
    id: string;
    email: string;
    fullName: string | null;
    role: "user" | "admin";
    status: string;
    emailVerifiedAt: Date | null;
    forcePasswordChange: boolean;
    mfaEnabled: boolean;
    mfaSecretEnc: string | null;
    mfaBackupCodes: string[];
    timezone: string;
  }>(
    `SELECT id, email, full_name, role, status, email_verified_at, force_password_change,
            mfa_enabled, mfa_secret_enc, mfa_backup_codes, timezone
       FROM users WHERE id = $1`,
    [consumed.userId],
  );
  if (!user || !user.mfaEnabled || user.status === "deleted" || user.status === "suspended") {
    return fail(401, "invalid_challenge", "This sign-in attempt could not be completed.");
  }

  let codeOk = false;
  let usedBackupCode = false;

  if (user.mfaSecretEnc) {
    try {
      const { verifyTotp } = await import("@/lib/auth/totp");
      const secret = decryptText(user.mfaSecretEnc, getMasterKey());
      if (secret) codeOk = verifyTotp(secret, body.code);
    } catch {
      codeOk = false;
    }
  }

  if (!codeOk) {
    const hashed = sha256Hex(body.code.toLowerCase());
    const codes = Array.isArray(user.mfaBackupCodes) ? user.mfaBackupCodes : [];
    if (codes.includes(hashed)) {
      codeOk = true;
      usedBackupCode = true;
      await db.raw(`UPDATE users SET mfa_backup_codes = array_remove(mfa_backup_codes, $2) WHERE id = $1`, [
        user.id,
        hashed,
      ]);
    }
  }

  if (!codeOk) {
    await recordAudit({
      action: "auth.mfa_failed",
      actorType: "user",
      actorId: user.id,
      actorLabel: user.email,
      ip,
      userAgent,
    });
    return fail(401, "invalid_code", "That verification code is not correct.");
  }

  const { token } = await createSession(user.id, { ip, userAgent });
  await setSessionCookie(token);

  const rememberDevice = (consumed.meta as { rememberDevice?: boolean })?.rememberDevice === true;
  if (rememberDevice) {
    const deviceValue = randomToken(24);
    await db.raw(
      `INSERT INTO trusted_devices (user_id, device_hash, device_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, device_hash) DO UPDATE SET last_used_at = now(), revoked_at = NULL`,
      [user.id, sha256Hex(deviceValue), (userAgent ?? "Unknown device").slice(0, 80)],
    );
    await setDeviceCookie(deviceValue);
  }

  await recordAudit({
    action: "auth.mfa_success",
    actorType: "user",
    actorId: user.id,
    actorLabel: user.email,
    ip,
    userAgent,
    metadata: { usedBackupCode },
  });

  return ok({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      emailVerified: Boolean(user.emailVerifiedAt),
      timezone: user.timezone,
      forcePasswordChange: user.forcePasswordChange,
      mfaEnabled: user.mfaEnabled,
    },
    requiresPasswordChange: user.forcePasswordChange,
    usedBackupCode,
    next: user.forcePasswordChange ? "/settings/security" : "/dashboard",
  });
});

export const runtime = "nodejs";
