import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireUser } from "@/lib/auth/guards";
import { recordAudit } from "@/lib/security/audit";
import { zTimezone } from "@/lib/validation/common";
import {
  checkinHistory,
  confirmCheckin,
  loadScheduleByUser,
  loadPolicyByVault,
  updateScheduleSettings,
} from "@/lib/checkin/engine";
import { getActiveCaseForUser } from "@/lib/release/engine";
import { vaultIdOf } from "@/lib/vault/modules";
import { db } from "@/lib/db";

/**
 * Check-in schedule: read state, change settings, confirm "I'm OK".
 * Confirmation cancels any pending release case through the engine — never
 * through a UI shortcut.
 */

const patchSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  localTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use a 24-hour time such as 09:00.").optional(),
  timezone: zTimezone().optional(),
  graceHours: z.number().int().min(0).max(720).optional(),
  reminders: z.array(z.enum(["d4", "d1", "due", "post1"])).max(4).optional(),
  status: z.enum(["active", "paused", "vacation", "disabled"]).optional(),
  pausedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const policyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  verificationMethod: z.enum(["email_otp", "trusted_contacts", "evidence_review"]).optional(),
  trustedContactThreshold: z.number().int().min(1).max(10).optional(),
  delaySeconds: z.number().int().min(0).max(604800).optional(),
  categories: z
    .array(z.enum(["financial", "digital", "documents", "properties", "messages"]))
    .min(1)
    .max(5)
    .optional(),
  overdueNoticeHours: z.number().int().min(0).max(720).optional(),
});

/** GET /api/checkins — schedule + policy + history + any open case. */
export const GET = handleRoute(async () => {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);

  const schedule = await loadScheduleByUser(ctx.user.id);
  if (!schedule) throw new ApiError(404, "not_found", "No check-in schedule exists for this account yet.");
  const policy = await loadPolicyByVault(vaultId);
  const history = await checkinHistory(schedule.id, 30);
  const activeCase = await getActiveCaseForUser(ctx.user.id);

  const caseSummary = activeCase
    ? {
        id: activeCase.id,
        state: activeCase.state,
        openedAt: activeCase.openedAt,
        verificationDeadlineAt: activeCase.verificationDeadlineAt,
        releaseAt: activeCase.releaseAt,
      }
    : null;

  return ok({ schedule, policy, history, activeCase: caseSummary });
});

/** PATCH /api/checkins — update schedule settings. */
export const PATCH = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, patchSchema);

  const schedule = await updateScheduleSettings(ctx.user.id, body);

  await recordAudit({
    action: "checkin.settings_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "checkin_schedule",
    targetId: schedule.id,
    metadata: { fields: Object.keys(body) },
  });

  return ok({ schedule });
});

/** POST /api/checkins — confirm "I'm OK" (cancels any pending release). */
export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();

  const result = await confirmCheckin(ctx.user.id, { ip, userAgent });
  const schedule = await loadScheduleByUser(ctx.user.id);

  await recordAudit({
    action: "checkin.confirmed",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "checkin_schedule",
    targetId: schedule?.id ?? "unknown",
    metadata: {
      nextDueAt: result.nextDueAt.toISOString(),
      canceledReleaseCaseId: result.canceledReleaseCaseId,
    },
  });

  return ok({
    confirmed: true,
    nextDueAt: result.nextDueAt,
    canceledReleaseCaseId: result.canceledReleaseCaseId,
    message: result.canceledReleaseCaseId
      ? "You're confirmed OK — the pending release case has been cancelled."
      : "You're confirmed OK. Your next check-in is scheduled.",
  });
});

/** PUT /api/checkins — update the release policy attached to the schedule. */
export const PUT = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, policyPatchSchema);
  const vaultId = await vaultIdOf(ctx.user.id);

  const colMap: Record<string, string> = {
    enabled: "enabled",
    verificationMethod: "verification_method",
    trustedContactThreshold: "trusted_contact_threshold",
    delaySeconds: "delay_seconds",
    categories: "categories",
    overdueNoticeHours: "overdue_notice_hours",
  };
  const sets: string[] = [];
  const vals: unknown[] = [vaultId];
  for (const [key, col] of Object.entries(colMap)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    vals.push(value);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) throw new ApiError(400, "nothing_to_update", "No changes were provided.");

  const updated = await db.q1(
    `UPDATE release_policies SET ${sets.join(", ")}, version = version + 1
      WHERE vault_id = $1
      RETURNING id, enabled, verification_method, trusted_contact_threshold, delay_seconds,
                categories, overdue_notice_hours, version`,
    vals,
  );
  if (!updated) throw new ApiError(404, "not_found", "Release policy not found.");

  await db.raw(
    `INSERT INTO checkin_events (schedule_id, type, details, actor_type, actor_id)
     SELECT id, 'policy_changed', $2::jsonb, 'user', $3 FROM checkin_schedules WHERE vault_id = $1`,
    [vaultId, JSON.stringify({ fields: Object.keys(body) }), ctx.user.id],
  );

  await recordAudit({
    action: "release.policy_updated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    targetType: "release_policy",
    targetId: vaultId,
    metadata: { fields: Object.keys(body) },
  });

  return ok({ policy: updated });
});

export const runtime = "nodejs";
