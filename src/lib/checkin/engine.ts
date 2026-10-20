import { db, withTransaction, type Queryable, type Tx } from "../db";
import { now, refreshClock } from "../clock";
import { ApiError } from "../api/http";
import { recordAudit } from "../security/audit";
import { cancelJobsForPayload } from "../jobs/queue";
import { cancelReleaseCaseForCheckin } from "../release/engine";
import {
  nextDueAfter,
  type Frequency,
  type ReminderKind,
  type ScheduleState,
  canTransition,
} from "./schedule";

/** Row shapes for schedules and policies as returned by camelizing queries. */

export interface ScheduleRow {
  id: string;
  vaultId: string;
  userId: string;
  policyId: string | null;
  frequency: Frequency;
  localTime: string;
  timezone: string;
  anchorDate: string;
  graceHours: number;
  status: "active" | "paused" | "vacation" | "disabled";
  pausedUntil: Date | null;
  currentState: ScheduleState;
  nextDueAt: Date;
  lastCheckinAt: Date | null;
  reminders: ReminderKind[];
  activeCaseId: string | null;
}

export interface PolicyRow {
  id: string;
  vaultId: string;
  enabled: boolean;
  verificationMethod: "email_otp" | "trusted_contacts" | "evidence_review";
  trustedContactThreshold: number;
  delaySeconds: number;
  categories: string[];
  overdueNoticeHours: number;
  version: number;
}

export const SCHEDULE_COLUMNS = `id, vault_id, user_id, policy_id, frequency, local_time, timezone,
  anchor_date, grace_hours, status, paused_until, current_state, next_due_at, last_checkin_at,
  reminders, active_case_id`;

export const POLICY_COLUMNS = `id, vault_id, enabled, verification_method, trusted_contact_threshold,
  delay_seconds, categories, overdue_notice_hours, version`;

export async function loadSchedule(scheduleId: string, exec: Queryable = db): Promise<ScheduleRow | null> {
  return exec.q1<ScheduleRow>(`SELECT ${SCHEDULE_COLUMNS} FROM checkin_schedules WHERE id = $1`, [scheduleId]);
}

export async function loadScheduleForUpdate(tx: Tx, scheduleId: string): Promise<ScheduleRow | null> {
  return tx.q1<ScheduleRow>(`SELECT ${SCHEDULE_COLUMNS} FROM checkin_schedules WHERE id = $1 FOR UPDATE`, [scheduleId]);
}

export async function loadScheduleByUser(userId: string, exec: Queryable = db): Promise<ScheduleRow | null> {
  return exec.q1<ScheduleRow>(
    `SELECT ${SCHEDULE_COLUMNS} FROM checkin_schedules WHERE user_id = $1`,
    [userId],
  );
}

export async function loadPolicy(policyId: string, exec: Queryable = db): Promise<PolicyRow | null> {
  return exec.q1<PolicyRow>(`SELECT ${POLICY_COLUMNS} FROM release_policies WHERE id = $1`, [policyId]);
}

export async function loadPolicyForShare(tx: Tx, policyId: string): Promise<PolicyRow | null> {
  return tx.q1<PolicyRow>(`SELECT ${POLICY_COLUMNS} FROM release_policies WHERE id = $1 FOR SHARE`, [policyId]);
}

export async function loadPolicyByVault(vaultId: string, exec: Queryable = db): Promise<PolicyRow | null> {
  return exec.q1<PolicyRow>(`SELECT ${POLICY_COLUMNS} FROM release_policies WHERE vault_id = $1`, [vaultId]);
}

/**
 * Compare-and-swap state transition. Illegal or stale transitions return false
 * without changing anything — this is what makes cancelled/stale jobs harmless.
 */
export async function advanceScheduleState(
  tx: Tx,
  scheduleId: string,
  fromStates: ScheduleState[],
  to: ScheduleState,
  details: Record<string, unknown> = {},
  actor: { type: "user" | "admin" | "system"; id?: string | null } = { type: "system" },
): Promise<boolean> {
  if (fromStates.length === 0 || !fromStates.every((s) => canTransition(s, to))) {
    // Guard: never attempt a transition that is not in the table.
    return false;
  }
  const res = await tx.raw(
    `UPDATE checkin_schedules
        SET current_state = $3, active_case_id = CASE WHEN $3 IN ('verification_pending', 'release_scheduled')
                                                      THEN active_case_id ELSE NULL END
      WHERE id = $1 AND current_state = ANY($2::text[])`,
    [scheduleId, fromStates, to],
  );
  if (!res.rowCount) return false;
  await tx.raw(
    `INSERT INTO checkin_events (schedule_id, type, details, actor_type, actor_id)
     VALUES ($1, 'state_changed', jsonb_build_object('from', $2::text, 'to', $3::text, 'extra', $4::jsonb), $5, $6)`,
    [
      scheduleId,
      JSON.stringify(fromStates),
      to,
      JSON.stringify(details),
      actor.type,
      actor.id ?? null,
    ],
  );
  return true;
}

export async function recordCheckinEvent(
  tx: Tx,
  scheduleId: string,
  type: string,
  details: Record<string, unknown> = {},
  actor: { type: "user" | "admin" | "system"; id?: string | null } = { type: "system" },
  idempotencyKey?: string,
): Promise<boolean> {
  const row = await tx.q1<{ id: number }>(
    `INSERT INTO checkin_events (schedule_id, type, details, actor_type, actor_id, idempotency_key)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [scheduleId, type, JSON.stringify(details), actor.type, actor.id ?? null, idempotencyKey ?? null],
  );
  return Boolean(row);
}

export interface CheckinResult {
  nextDueAt: Date;
  canceledReleaseCaseId: string | null;
}

/**
 * Confirm the user is OK: resets escalation state, cancels any pending release
 * (including its queued jobs) and reschedules the next check-in.
 * Idempotent enough for double-clicks: state CAS + event uniqueness.
 */
export async function confirmCheckin(
  userId: string,
  opts: { ip?: string | null; userAgent?: string | null } = {},
): Promise<CheckinResult> {
  await refreshClock(); // request-path entry: pick up the controlled clock offset
  return withTransaction(async (tx) => {
    const schedule = await tx.q1<ScheduleRow>(
      `SELECT ${SCHEDULE_COLUMNS} FROM checkin_schedules WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (!schedule) throw new ApiError(404, "not_found", "No check-in schedule exists for this account yet.");

    const currentDue = new Date(schedule.nextDueAt).getTime();

    // Cancel any open release case and its queued jobs (spec: a successful
    // check-in invalidates any pending release that has not legitimately completed).
    const canceledCaseId = await cancelReleaseCaseForCheckin(tx, schedule, "checkin");

    // Invalidate queued escalation jobs for the due date being superseded.
    for (const type of ["checkin.mark_overdue", "checkin.grace_start", "checkin.begin_verification"]) {
      await cancelJobsForPayload(type, { scheduleId: schedule.id, dueIso: new Date(currentDue).toISOString() }, tx);
    }

    const spec = {
      frequency: schedule.frequency,
      localTime: schedule.localTime,
      timezone: schedule.timezone,
      anchorDate: schedule.anchorDate,
    };
    const nextDue = nextDueAfter(spec, now());
    if (!nextDue) throw new ApiError(500, "schedule_error", "Could not compute your next check-in date.");

    await advanceScheduleState(
      tx,
      schedule.id,
      ["active", "reminder_sent", "overdue", "grace_period", "verification_pending", "release_scheduled", "released", "incident"],
      "active",
      { reason: "checkin" },
      { type: "user", id: userId },
    );

    await tx.raw(
      `UPDATE checkin_schedules
          SET last_checkin_at = now(), next_due_at = $2, active_case_id = NULL
        WHERE id = $1`,
      [schedule.id, nextDue],
    );

    await recordCheckinEvent(
      tx,
      schedule.id,
      "checkin_confirmed",
      { nextDueAt: nextDue.toISOString(), canceledReleaseCaseId: canceledCaseId },
      { type: "user", id: userId },
      `checkin:${schedule.id}:${Math.floor(now().getTime() / 60_000)}`, // one event per minute max
    );
    await recordCheckinEvent(
      tx,
      schedule.id,
      "rescheduled",
      { nextDueAt: nextDue.toISOString() },
      { type: "user", id: userId },
    );

    await recordAudit(
      {
        action: "checkin.confirmed",
        actorType: "user",
        actorId: userId,
        targetType: "checkin_schedule",
        targetId: schedule.id,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        metadata: { canceledReleaseCaseId: canceledCaseId, nextDueAt: nextDue.toISOString() },
      },
      tx,
    );

    return { nextDueAt: nextDue, canceledReleaseCaseId: canceledCaseId };
  });
}

export async function updateScheduleSettings(
  userId: string,
  patch: {
    frequency?: Frequency;
    localTime?: string;
    timezone?: string;
    graceHours?: number;
    reminders?: ReminderKind[];
    status?: "active" | "paused" | "vacation" | "disabled";
    pausedUntil?: string | null;
    anchorDate?: string;
  },
): Promise<ScheduleRow> {
  return withTransaction(async (tx) => {
    const schedule = await loadScheduleByUser(userId, tx);
    if (!schedule) throw new ApiError(404, "not_found", "No check-in schedule exists for this account yet.");

    const frequency = patch.frequency ?? schedule.frequency;
    const localTime = patch.localTime ?? schedule.localTime;
    const timezone = patch.timezone ?? schedule.timezone;
    const anchorDate = patch.anchorDate ?? schedule.anchorDate;

    const spec = { frequency, localTime, timezone, anchorDate };
    const nextDue = nextDueAfter(spec, now());
    if (!nextDue) {
      throw new ApiError(400, "invalid_request", "Could not compute the next check-in from those settings.", {
        timezone: ["Use a valid IANA timezone such as Africa/Nairobi."],
      });
    }

    const updated = await tx.q1<ScheduleRow>(
      `UPDATE checkin_schedules
          SET frequency = $2, local_time = $3, timezone = $4, anchor_date = $5,
              grace_hours = $6, reminders = $7::jsonb, status = $8, paused_until = $9,
              next_due_at = $10
        WHERE id = $1
        RETURNING ${SCHEDULE_COLUMNS}`,
      [
        schedule.id,
        frequency,
        localTime,
        timezone,
        anchorDate,
        patch.graceHours ?? schedule.graceHours,
        JSON.stringify(patch.reminders ?? schedule.reminders),
        patch.status ?? schedule.status,
        patch.pausedUntil ?? null,
        nextDue,
      ],
    );
    if (!updated) throw new ApiError(500, "update_failed", "Could not save check-in settings.");

    await recordCheckinEvent(tx, schedule.id, "policy_changed", { patch: { ...patch } }, { type: "user", id: userId });
    await recordAudit(
      {
        action: "checkin.settings_changed",
        actorType: "user",
        actorId: userId,
        targetType: "checkin_schedule",
        targetId: schedule.id,
        metadata: { frequency, timezone, graceHours: patch.graceHours ?? schedule.graceHours, status: patch.status ?? schedule.status },
      },
      tx,
    );

    return updated;
  });
}

export interface CheckinHistoryEntry {
  id: number;
  type: string;
  details: Record<string, unknown>;
  actorType: string;
  occurredAt: Date;
}

export async function checkinHistory(scheduleId: string, limit = 50): Promise<CheckinHistoryEntry[]> {
  return db.q<CheckinHistoryEntry>(
    `SELECT id, type, details, actor_type, occurred_at
       FROM checkin_events
      WHERE schedule_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [scheduleId, Math.min(limit, 200)],
  );
}
