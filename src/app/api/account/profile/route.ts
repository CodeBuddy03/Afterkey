import { z } from "zod";
import { handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/security/audit";
import { zShortText, zTimezone } from "@/lib/validation/common";

const patchSchema = z.object({
  fullName: zShortText(120).optional(),
  timezone: zTimezone().optional(),
  locale: z.enum(["en"]).optional(),
  notificationPrefs: z
    .object({
      checkinReminders: z.boolean().optional(),
      securityAlerts: z.boolean().optional(),
      releaseAlerts: z.boolean().optional(),
      productUpdates: z.boolean().optional(),
    })
    .optional(),
});

export const GET = handleRoute(async () => {
  const ctx = await requireUser();
  const profile = await db.q1<{
    fullName: string | null;
    email: string;
    timezone: string;
    locale: string;
    notificationPrefs: Record<string, boolean>;
    emailVerifiedAt: Date | null;
    mfaEnabled: boolean;
    createdAt: Date;
  }>(
    `SELECT full_name, email, timezone, locale, notification_prefs, email_verified_at, mfa_enabled, created_at
       FROM users WHERE id = $1`,
    [ctx.user.id],
  );
  return ok({ profile });
});

export const PATCH = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, patchSchema);

  const updated = await db.q1<{
    fullName: string | null;
    timezone: string;
    locale: string;
    notificationPrefs: Record<string, boolean>;
  }>(
    `UPDATE users
        SET full_name = COALESCE($2, full_name),
            timezone = COALESCE($3, timezone),
            locale = COALESCE($4, locale),
            notification_prefs = notification_prefs || $5::jsonb
      WHERE id = $1
      RETURNING full_name, timezone, locale, notification_prefs`,
    [
      ctx.user.id,
      body.fullName ?? null,
      body.timezone ?? null,
      body.locale ?? null,
      JSON.stringify(body.notificationPrefs ?? {}),
    ],
  );

  await recordAudit({
    action: "account.profile_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    metadata: { fields: Object.keys(body) },
  });

  return ok({ profile: updated });
});

export const runtime = "nodejs";
