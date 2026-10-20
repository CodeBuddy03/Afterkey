import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env, isProduction } from "../env";
import { resolveSession, type AuthContext } from "./session";
import { ApiError } from "../api/http";

export const SESSION_COOKIE = "ak_session";
export const DEVICE_COOKIE = "ak_device";

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(Math.max(1, env().SESSION_TTL_DAYS) * 86400));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function setDeviceCookie(deviceHash: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEVICE_COOKIE, deviceHash, { ...cookieOptions(90 * 86400) });
}

export async function clearDeviceCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(DEVICE_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function getDeviceHash(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(DEVICE_COOKIE)?.value ?? null;
}

/** Current authenticated context, or null. Always server-side verified against the database. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return resolveSession(token);
}

/** For API handlers: throws a 401 ApiError when not authenticated. */
export async function requireUser(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new ApiError(401, "auth_required", "Please sign in to continue.");
  return ctx;
}

/** For pages: redirect to sign-in when not authenticated. */
export async function requireUserPage(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/signin");
  return ctx;
}

export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.user.role !== "admin") {
    throw new ApiError(403, "admin_required", "Administrator access is required.");
  }
  return ctx;
}

export async function requireAdminPage(): Promise<AuthContext> {
  const ctx = await requireUserPage();
  if (ctx.user.role !== "admin") redirect("/dashboard");
  return ctx;
}

/** Recipient and release operations require a verified email address. */
export function requireVerified(ctx: AuthContext): void {
  if (!ctx.user.emailVerifiedAt) {
    throw new ApiError(403, "email_verification_required", "Verify your email address before performing this action.");
  }
}

/**
 * Reauthentication for sensitive actions (credential access, release
 * cancellation, account deletion, admin interventions). The session must have
 * completed a password (or MFA) re-challenge within `maxAgeMinutes`.
 */
export function requireRecentReauth(ctx: AuthContext, maxAgeMinutes = 15): void {
  const at = ctx.session.reauthAt;
  if (!at || Date.now() - new Date(at).getTime() > maxAgeMinutes * 60_000) {
    throw new ApiError(403, "reauth_required", "Confirm your password to continue.");
  }
}

export function assertActiveAccount(ctx: AuthContext): void {
  const s = ctx.user.status;
  if (s === "suspended") {
    throw new ApiError(403, "account_suspended", "This account is suspended. Contact support for help.");
  }
  if (s === "deleted") {
    throw new ApiError(403, "account_deleted", "This account has been deleted.");
  }
}

/**
 * CSRF protection for state-changing requests: same-site cookies are the
 * first layer; this rejects requests whose Origin header does not match the
 * application origin (browser cross-site requests always send Origin).
 * Non-browser clients (no Origin header) rely on cookie same-site rules.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "bad_origin", "Request origin is not allowed.");
  }
  const expected = new URL(env().APP_URL).host;
  const host = req.headers.get("host") ?? expected;
  if (originHost !== expected && originHost !== host) {
    throw new ApiError(403, "bad_origin", "Request origin is not allowed.");
  }
}

export async function currentIpAndAgent(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]?.trim() ?? null : h.get("x-real-ip");
  return { ip: ip ?? null, userAgent: h.get("user-agent") };
}
