import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import {
  assertSameOrigin,
  currentIpAndAgent,
  getDeviceHash,
  setSessionCookie,
} from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { issueToken } from "@/lib/auth/tokens";
import { createSession } from "@/lib/auth/session";
import { isProduction } from "@/lib/env";
import { recordAudit } from "@/lib/security/audit";
import { AUTH_LIMITS, limiterKey, rateLimit } from "@/lib/security/rate-limit";
import { queueEmail } from "@/lib/email/outbox";
import { renderEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/urls";
import { randomToken, sha256Hex } from "@/lib/crypto/encryption";
import { zEmail, zPassword } from "@/lib/validation/common";
import { db } from "@/lib/db";

const schema = z.object({
  email: zEmail(),
  password: zPassword(),
  rememberDevice: z.boolean().optional(),
  deviceName: z.string().trim().max(80).optional(),
});

let dummyHash: string | null = null;
async function timingEqualizer(password: string): Promise<void> {
  if (!dummyHash) dummyHash = await hashPassword("afterkey-timing-equalizer-0000");
  await verifyPassword(dummyHash, password);
}

const INVALID = () => fail(401, "invalid_credentials", "Email or password is incorrect.");

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, schema);

  const limit = await rateLimit({
    key: limiterKey(["auth:login", body.email, ip ?? "local"]),
    limit: AUTH_LIMITS.login.limit,
    windowSeconds: AUTH_LIMITS.login.windowSeconds,
  });
  if (!limit.ok) {
    return fail(
      429,
      "rate_limited",
      `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
    );
  }

  const user = await db.q1<{
    id: string;
    email: string;
    passwordHash: string | null;
    fullName: string | null;
    role: "user" | "admin";
    status: "unverified" | "active" | "suspended" | "deletion_pending" | "deleted";
    emailVerifiedAt: Date | null;
    isSeedTestAccount: boolean;
    forcePasswordChange: boolean;
    mfaEnabled: boolean;
    mfaSecretEnc: string | null;
    mfaBackupCodes: string[];
    timezone: string;
    locale: string;
    notificationPrefs: Record<string, boolean>;
    createdAt: Date;
  }>(
    `SELECT id, email, password_hash, full_name, role, status, email_verified_at, is_seed_test_account,
            force_password_change, mfa_enabled, mfa_secret_enc, mfa_backup_codes, timezone, locale,
            notification_prefs, created_at
       FROM users WHERE email = $1`,
    [body.email],
  );

  const valid = user?.passwordHash ? await verifyPassword(user.passwordHash, body.password) : (await timingEqualizer(body.password), false);

  // Seeded development accounts can never authenticate in production.
  const seedBlocked = Boolean(user?.isSeedTestAccount) && isProduction();

  if (!user || !valid || seedBlocked) {
    await recordAudit({
      action: "auth.login_failed",
      actorType: "system",
      actorLabel: body.email,
      ip,
      userAgent,
      metadata: { reason: !user ? "unknown_email" : !valid ? "bad_password" : "blocked" },
    });
    return INVALID();
  }

  if (user.status === "deleted") return INVALID();

  if (user.status === "suspended") {
    await recordAudit({
      action: "auth.login_blocked_suspended",
      actorType: "user",
      actorId: user.id,
      actorLabel: user.email,
      ip,
      userAgent,
    });
    return fail(403, "account_suspended", "This account is suspended. Please contact support for assistance.");
  }

  if (!user.emailVerifiedAt) {
    await queueEmail({
      to: user.email,
      template: "verify_email",
      rendered: renderEmail("verify_email", {
        name: user.fullName ?? "",
        url: appUrl(`/verify-email?token=see-recent-email`),
        expiresIn: "24 hours",
      }),
      userId: user.id,
      dedupeKey: `verify-reminder:${user.id}:${Math.floor(Date.now() / 3_600_000)}`,
    });
  }

  // MFA challenge: no session yet; a short-lived single-use token is required.
  if (user.mfaEnabled) {
    const challenge = await issueToken(db, user.id, "mfa_challenge", 300, {
      rememberDevice: body.rememberDevice === true,
    });
    await recordAudit({
      action: "auth.mfa_challenge_issued",
      actorType: "user",
      actorId: user.id,
      actorLabel: user.email,
      ip,
      userAgent,
    });
    return ok({ requiresMfa: true, mfaToken: challenge.raw, expiresAt: challenge.expiresAt.toISOString() });
  }

  const trustedDevice = await getDeviceHash();
  const knownDevice = trustedDevice
    ? Boolean(
        await db.q1(
          `SELECT id FROM trusted_devices WHERE user_id = $1 AND device_hash = $2 AND revoked_at IS NULL`,
          [user.id, sha256Hex(trustedDevice)],
        ),
      )
    : false;

  const { token } = await createSession(user.id, { ip, userAgent });
  await setSessionCookie(token);

  if (body.rememberDevice) {
    const deviceValue = randomToken(24);
    const deviceName = (body.deviceName ?? (userAgent ? userAgent.slice(0, 80) : "Unknown device")).slice(0, 80);
    await db.raw(
      `INSERT INTO trusted_devices (user_id, device_hash, device_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, device_hash)
       DO UPDATE SET last_used_at = now(), revoked_at = NULL`,
      [user.id, sha256Hex(deviceValue), deviceName],
    );
    const { setDeviceCookie } = await import("@/lib/auth/guards");
    await setDeviceCookie(deviceValue);
  }

  if (!knownDevice) {
    await queueEmail({
      to: user.email,
      template: "new_device",
      rendered: renderEmail("new_device", {
        device: body.deviceName ?? (userAgent ? userAgent.slice(0, 80) : "Unknown device"),
        time: new Date().toUTCString(),
        url: appUrl("/settings/security"),
      }),
      userId: user.id,
      relatedType: "user",
      relatedId: user.id,
      dedupeKey: `newdevice:${user.id}:${Math.floor(Date.now() / 600_000)}`,
    });
  }

  await recordAudit({
    action: "auth.login_success",
    actorType: "user",
    actorId: user.id,
    actorLabel: user.email,
    ip,
    userAgent,
    metadata: { knownDevice },
  });

  const { clearRateLimit } = await import("@/lib/security/rate-limit");
  await clearRateLimit(limiterKey(["auth:login", body.email, ip ?? "local"]));

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
    next: user.status === "deletion_pending" ? "/settings/privacy" : user.forcePasswordChange ? "/settings/security" : "/onboarding",
  });
});

export const runtime = "nodejs";
