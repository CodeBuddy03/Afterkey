import { db, withTransaction } from "../db";
import { now, refreshClock } from "../clock";
import { log } from "../logger";
import { enqueue, type JobRow } from "./queue";
import {
  advanceScheduleState,
  loadPolicy,
  loadSchedule,
  recordCheckinEvent,
  type ScheduleRow,
} from "../checkin/engine";
import { reminderScheduleFor, graceEnd, overdueNoticeEnd, type ReminderKind } from "../checkin/schedule";
import { executeRelease, openReleaseCase } from "../release/engine";
import { queueEmail } from "../email/outbox";
import { renderEmail } from "../email/templates";
import { appUrl } from "../urls";
import { recordAudit } from "../security/audit";
import { getStorage } from "../storage/storage";

/**
 * Background job processors. Every handler is idempotent: re-running it either
 * does nothing (state CAS fails, unique keys collide) or completes the same
 * logical step. Handlers throw only on transient errors (→ retry with backoff);
 * policy-based refusals are recorded and return normally (→ no retry loop).
 */

export async function runJob(job: JobRow): Promise<void> {
  switch (job.type) {
    case "checkin.reminder":
      return handleReminder(job);
    case "checkin.mark_overdue":
      return handleMarkOverdue(job);
    case "checkin.grace_start":
      return handleGraceStart(job);
    case "checkin.begin_verification":
      return handleBeginVerification(job);
    case "release.execute":
      return handleReleaseExecute(job);
    case "account.deletion.execute":
      return handleDeletionExecute(job);
    case "email.send":
      return handleEmailSend(job);
    default:
      log.warn("unknown_job_type", { type: job.type, jobId: job.id });
  }
}

interface DuePayload {
  scheduleId?: string;
  dueIso?: string;
  kind?: string;
}

function payloadDue(job: JobRow): { scheduleId: string; dueIso: string } | null {
  const p = job.payload as DuePayload;
  if (!p?.scheduleId || !p?.dueIso) return null;
  return { scheduleId: p.scheduleId, dueIso: p.dueIso };
}

/** True when this job's due date is still the schedule's current due date. */
async function dueIsCurrent(schedule: ScheduleRow, dueIso: string): Promise<boolean> {
  return new Date(schedule.nextDueAt).toISOString() === dueIso;
}

/* ---------------------------- check-in jobs ---------------------------- */

async function handleReminder(job: JobRow): Promise<void> {
  const params = payloadDue(job);
  if (!params) return;
  const schedule = await loadSchedule(params.scheduleId);
  if (!schedule || schedule.status !== "active") return;
  if (!(await dueIsCurrent(schedule, params.dueIso))) return;
  if (!["active", "reminder_sent"].includes(schedule.currentState)) return;

  const kind = (job.payload.kind as ReminderKind) ?? "due";
  const due = new Date(params.dueIso);

  const user = await db.q1<{ email: string; fullName: string | null }>(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [schedule.userId],
  );
  if (!user) return;

  const dayLabel =
    kind === "d4" ? "in four days" : kind === "d1" ? "tomorrow" : kind === "due" ? "now" : "was due yesterday";

  await queueEmail({
    to: user.email,
    template: "checkin_reminder",
    rendered: renderEmail("checkin_reminder", {
      name: user.fullName ?? "",
      dueLabel: `${dueLabel(due, schedule.timezone)} (${dayLabel})`,
      timezone: schedule.timezone,
      detail:
        kind === "due"
          ? "Confirming that you are OK takes one tap and keeps everything paused."
          : "This is an advance reminder so nothing surprises you.",
      url: appUrl("/checkins"),
      consequence: `After the due time you have ${schedule.graceHours} hour(s) of grace before your configured verification procedure begins.`,
    }),
    userId: schedule.userId,
    relatedType: "checkin_schedule",
    relatedId: schedule.id,
    dedupeKey: `rem:${schedule.id}:${params.dueIso}:${kind}`,
  });

  await withTransaction(async (tx) => {
    await advanceScheduleState(tx, schedule.id, ["active"], "reminder_sent", { kind, dueIso: params.dueIso });
    await recordCheckinEvent(
      tx,
      schedule.id,
      "reminder_sent",
      { kind, dueIso: params.dueIso },
      { type: "system" },
      `rem:${schedule.id}:${params.dueIso}:${kind}`,
    );
  });
}

async function handleMarkOverdue(job: JobRow): Promise<void> {
  const params = payloadDue(job);
  if (!params) return;
  const schedule = await loadSchedule(params.scheduleId);
  if (!schedule || schedule.status !== "active") return;
  if (!(await dueIsCurrent(schedule, params.dueIso))) return;
  if (!["active", "reminder_sent"].includes(schedule.currentState)) return;

  const user = await db.q1<{ email: string; fullName: string | null }>(
    `SELECT email, full_name FROM users WHERE id = $1`,
    [schedule.userId],
  );

  const due = new Date(params.dueIso);
  const grace = graceEnd(due, schedule.graceHours);

  await withTransaction(async (tx) => {
    const advanced = await advanceScheduleState(
      tx,
      schedule.id,
      ["active", "reminder_sent"],
      "overdue",
      { dueIso: params.dueIso },
    );
    if (!advanced) return;
    await recordCheckinEvent(tx, schedule.id, "overdue_marked", { dueIso: params.dueIso }, { type: "system" }, `overdue:${schedule.id}:${params.dueIso}`);
  });

  if (user) {
    await queueEmail({
      to: user.email,
      template: "checkin_overdue",
      rendered: renderEmail("checkin_overdue", {
        name: user.fullName ?? "",
        graceEndsLabel: formatDate(grace, schedule.timezone),
        url: appUrl("/checkins"),
        consequence:
          "If the grace period ends without a check-in, your configured verification procedure begins before anything can be shared. Nothing is released without it.",
      }),
      userId: schedule.userId,
      relatedType: "checkin_schedule",
      relatedId: schedule.id,
      dedupeKey: `overdue:${schedule.id}:${params.dueIso}`,
    });
  }

  await recordAudit({
    action: "checkin.overdue",
    actorType: "system",
    targetType: "checkin_schedule",
    targetId: schedule.id,
    metadata: { dueIso: params.dueIso, graceHours: schedule.graceHours },
  });
}

async function handleGraceStart(job: JobRow): Promise<void> {
  const params = payloadDue(job);
  if (!params) return;
  const schedule = await loadSchedule(params.scheduleId);
  if (!schedule || schedule.status !== "active") return;
  if (!(await dueIsCurrent(schedule, params.dueIso))) return;

  await withTransaction(async (tx) => {
    const advanced = await advanceScheduleState(tx, schedule.id, ["overdue"], "grace_period", {
      dueIso: params.dueIso,
    });
    if (advanced) {
      await recordCheckinEvent(tx, schedule.id, "grace_started", { dueIso: params.dueIso }, { type: "system" }, `grace:${schedule.id}:${params.dueIso}`);
    }
  });
}

async function handleBeginVerification(job: JobRow): Promise<void> {
  const params = payloadDue(job);
  if (!params) return;
  const schedule = await loadSchedule(params.scheduleId);
  if (!schedule || schedule.status !== "active") return;
  if (!(await dueIsCurrent(schedule, params.dueIso))) return;

  const policy = schedule.policyId ? await loadPolicy(schedule.policyId) : null;

  if (!policy || !policy.enabled) {
    // No release configured: notify once, stay in the escalation state (no case).
    const user = await db.q1<{ email: string; fullName: string | null }>(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [schedule.userId],
    );
    if (user) {
      await queueEmail({
        to: user.email,
        template: "escalation_notice",
        rendered: renderEmail("escalation_notice", {
          ownerName: user.fullName ?? "",
          detail:
            "Your grace period has ended without a check-in. No release is configured on your account, so nothing will ever be shared — this is only a reminder to check in.",
          url: appUrl("/checkins"),
        }),
        userId: schedule.userId,
        relatedType: "checkin_schedule",
        relatedId: schedule.id,
        dedupeKey: `norelease:${schedule.id}:${params.dueIso}`,
      });
    }
    await withTransaction(async (tx) => {
      await recordCheckinEvent(
        tx,
        schedule.id,
        "release_blocked",
        { reason: "release_policy_disabled", dueIso: params.dueIso },
        { type: "system" },
        `norelease:${schedule.id}:${params.dueIso}`,
      );
    });
    return;
  }

  const opened = await openReleaseCase(schedule.id, params.dueIso);
  if (!opened) {
    log.info("release_case_not_opened", { scheduleId: schedule.id, dueIso: params.dueIso });
  }
}

async function handleReleaseExecute(job: JobRow): Promise<void> {
  const caseId = (job.payload as { caseId?: string }).caseId;
  if (!caseId) return;
  const outcome = await executeRelease(caseId);
  if (outcome.result === "blocked") {
    log.warn("release_blocked", { caseId, reason: outcome.reason });
  } else if (outcome.result === "released") {
    log.info("release_executed", { caseId, deliveries: outcome.deliveries });
  } else if (outcome.result === "stale") {
    log.info("release_stale_job_ignored", { caseId, state: outcome.state });
  }
}

async function handleDeletionExecute(job: JobRow): Promise<void> {
  const requestId = (job.payload as { requestId?: string }).requestId;
  if (!requestId) return;

  const outcome = await withTransaction(async (tx) => {
    const req = await tx.q1<{ id: string; userId: string; status: string; executeAfter: Date | null }>(
      `SELECT id, user_id, status, execute_after FROM data_deletion_requests WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (!req || req.status !== "scheduled") return { done: true, docs: [] as Array<{ storageKey: string }> };
    if (req.executeAfter && new Date(req.executeAfter).getTime() > now().getTime()) {
      await enqueue(
        { type: "account.deletion.execute", payload: { requestId }, runAt: new Date(req.executeAfter), idempotencyKey: `deletion:${requestId}:late` },
        tx,
      );
      return { done: true, docs: [] as Array<{ storageKey: string }> };
    }

    // Collect storage objects before rows cascade away.
    const docs = await tx.q<{ storageKey: string }>(
      `SELECT storage_key FROM documents d JOIN vaults v ON v.id = d.vault_id WHERE v.user_id = $1`,
      [req.userId],
    );

    await tx.raw(`UPDATE recipient_invitations SET revoked_at = now() WHERE created_by = $1 AND revoked_at IS NULL`, [
      req.userId,
    ]);
    await tx.raw(`UPDATE recipients SET created_by = NULL WHERE created_by = $1`, [req.userId]);
    await tx.raw(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.userId]);
    await tx.raw(`DELETE FROM email_tokens WHERE user_id = $1`, [req.userId]);
    await tx.raw(`DELETE FROM vaults WHERE user_id = $1`, [req.userId]); // cascades to all vault modules
    await tx.raw(
      `UPDATE users
          SET email = 'deleted+' || id || '@afterkey.invalid',
              password_hash = NULL, full_name = NULL, status = 'deleted',
              email_verified_at = NULL, mfa_enabled = FALSE, mfa_secret_enc = NULL,
              deleted_at = now()
        WHERE id = $1`,
      [req.userId],
    );
    await tx.raw(
      `UPDATE data_deletion_requests SET status = 'completed', completed_at = now() WHERE id = $1`,
      [requestId],
    );
    await recordAudit(
      {
        action: "account.deleted",
        actorType: "system",
        actorId: req.userId,
        targetType: "user",
        targetId: req.userId,
        metadata: { requestId, documentsRemoved: docs.length },
      },
      tx,
    );
    return { done: true, docs };
  });

  // Storage cleanup happens after commit (row deletion must not depend on it).
  if (outcome.docs?.length) {
    for (const doc of outcome.docs) {
      await getStorage()
        .delete(doc.storageKey)
        .catch((err: unknown) => {
          log.warn("storage_delete_failed_after_deletion", {
            error: err instanceof Error ? err.message : "unknown",
          });
        });
    }
  }
}

/* ---------------------------- maintenance ----------------------------- */

function dueLabel(date: Date, zone: string): string {
  return formatDate(date, zone);
}

function formatDate(date: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: zone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Scheduled-work maintenance: ensures reminder/overdue/grace/verification jobs
 * exist for every active schedule within the horizon. Idempotent — unique
 * idempotency keys make repeated sweeps free.
 */
export async function runCheckinMaintenance(limit = 500): Promise<{ schedules: number; enqueued: number }> {
  await refreshClock();
  const schedules = await db.q<
    ScheduleRow & { policyEnabled: boolean | null }
  >(
    `SELECT s.id, s.vault_id, s.user_id, s.policy_id, s.frequency, s.local_time, s.timezone,
            s.anchor_date, s.grace_hours, s.status, s.paused_until, s.current_state, s.next_due_at,
            s.last_checkin_at, s.reminders, s.active_case_id,
            p.enabled AS policy_enabled
       FROM checkin_schedules s
       LEFT JOIN release_policies p ON p.id = s.policy_id
      WHERE s.status = 'active'
        AND s.next_due_at < $2::timestamptz + interval '7 days'
      ORDER BY s.next_due_at
      LIMIT $1`,
    [limit, now()],
  );

  let enqueued = 0;
  const t = now();

  for (const schedule of schedules) {
    const spec = {
      frequency: schedule.frequency,
      localTime: schedule.localTime,
      timezone: schedule.timezone,
      anchorDate: schedule.anchorDate,
    };
    const due = new Date(schedule.nextDueAt);
    const dueIso = due.toISOString();
    const reminders = (Array.isArray(schedule.reminders) ? schedule.reminders : []) as ReminderKind[];

    if (["active", "reminder_sent"].includes(schedule.currentState)) {
      // Reminders (only those that still make sense, per interval rule).
      for (const rem of reminderScheduleFor(due, spec, reminders)) {
        const runAt = rem.at.getTime() > t.getTime() ? rem.at : new Date(t.getTime() + 2000);
        if (runAt.getTime() > due.getTime() + 60_000 && rem.kind !== "post1") {
          // Reminder would fire after the due time (late worker) — skip; overdue job covers it.
          continue;
        }
        const id = await enqueue({
          type: "checkin.reminder",
          payload: { scheduleId: schedule.id, dueIso, kind: rem.kind },
          runAt,
          idempotencyKey: `rem:${schedule.id}:${dueIso}:${rem.kind}`,
        });
        if (id) enqueued += 1;
      }

      // Overdue marker.
      const overdueId = await enqueue({
        type: "checkin.mark_overdue",
        payload: { scheduleId: schedule.id, dueIso },
        runAt: due,
        idempotencyKey: `overdue:${schedule.id}:${dueIso}`,
      });
      if (overdueId) enqueued += 1;

      // Grace-period entry (only when the notice window is shorter than grace).
      const noticeHours = 1;
      const grace = graceEnd(due, schedule.graceHours);
      if (noticeHours < schedule.graceHours) {
        const graceRunAt = overdueNoticeEnd(due, noticeHours);
        const gid = await enqueue({
          type: "checkin.grace_start",
          payload: { scheduleId: schedule.id, dueIso },
          runAt: graceRunAt,
          idempotencyKey: `grace:${schedule.id}:${dueIso}`,
        });
        if (gid) enqueued += 1;
      }

      // Verification begins at grace end (handler checks policy.enabled).
      const vid = await enqueue({
        type: "checkin.begin_verification",
        payload: { scheduleId: schedule.id, dueIso },
        runAt: grace,
        idempotencyKey: `verify:${schedule.id}:${dueIso}`,
        maxAttempts: 10,
      });
      if (vid) enqueued += 1;
    } else if (["overdue", "grace_period"].includes(schedule.currentState)) {
      // Downtime recovery: the state lagged behind; make sure the next step exists.
      const vid = await enqueue({
        type: "checkin.begin_verification",
        payload: { scheduleId: schedule.id, dueIso },
        runAt: graceEnd(due, schedule.graceHours),
        idempotencyKey: `verify:${schedule.id}:${dueIso}`,
        maxAttempts: 10,
      });
      if (vid) enqueued += 1;
      if (schedule.graceHours > 1) {
        const gid = await enqueue({
          type: "checkin.grace_start",
          payload: { scheduleId: schedule.id, dueIso },
          runAt: overdueNoticeEnd(due, 1),
          idempotencyKey: `grace:${schedule.id}:${dueIso}`,
        });
        if (gid) enqueued += 1;
      }
    }
  }

  return { schedules: schedules.length, enqueued };
}

/** Requeue queued email messages that were never given a delivery job. */
export async function ensureEmailJobs(limit = 10): Promise<number> {
  const rows = await db.q<{ id: string; attempts: number }>(
    `SELECT id, attempts FROM email_messages
      WHERE status = 'queued'
        AND (attempts = 0
             OR updated_at < now() - interval '10 minutes')
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );
  let enqueued = 0;
  for (const row of rows) {
    const id = await enqueue({
      type: "email.send",
      payload: { messageId: row.id },
      idempotencyKey: `email:${row.id}:a${row.attempts}`,
      maxAttempts: 6,
    });
    if (id) enqueued += 1;
  }
  return enqueued;
}

/** Send one email message end-to-end (job handler). */
export async function handleEmailSend(job: JobRow): Promise<void> {
  const messageId = (job.payload as { messageId?: string }).messageId;
  if (!messageId) return;

  const { claimEmailForSending, markEmailSent, markEmailFailed } = await import("../email/outbox");
  const { deliverEmail } = await import("../email/provider");

  const message = await claimEmailForSending(messageId);
  if (!message) {
    // Already sent, canceled, or attempts exhausted on the message row itself.
    return;
  }

  const result = await deliverEmail(message);
  if (result.ok) {
    await markEmailSent(messageId, result.provider, result.providerMessageId ?? null);
    if (result.storedOnly) {
      log.info("email_stored_not_delivered", { messageId, provider: result.provider });
    }
    return;
  }

  await markEmailFailed(messageId, result.errorCode ?? "send_failed", result.errorDetail ?? "unknown error");
  const after = await db.q1<{ attempts: number; maxAttempts: number }>(
    `SELECT attempts, max_attempts FROM email_messages WHERE id = $1`,
    [messageId],
  );
  if (after && after.attempts < after.maxAttempts) {
    throw new Error(`email send failed (${result.errorCode ?? "unknown"}): retrying`);
  }
  // Dead-lettered: do not retry; an admin alert was queued by markEmailFailed.
  await recordAudit({
    action: "email.dead_lettered",
    actorType: "system",
    targetType: "email_message",
    targetId: messageId,
    metadata: { code: result.errorCode ?? "send_failed" },
  });
}

export const PROCESSOR_TYPES = [
  "checkin.reminder",
  "checkin.mark_overdue",
  "checkin.grace_start",
  "checkin.begin_verification",
  "release.execute",
  "account.deletion.execute",
  "email.send",
];
