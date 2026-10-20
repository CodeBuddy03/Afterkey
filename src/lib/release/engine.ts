import { db, withTransaction, type Queryable, type Tx } from "../db";
import { now, refreshClock } from "../clock";
import { ApiError } from "../api/http";
import { recordAudit } from "../security/audit";
import { cancelJobsForPayload, enqueue } from "../jobs/queue";
import { issueToken, consumeToken } from "../auth/tokens";
import { queueEmail } from "../email/outbox";
import { renderEmail } from "../email/templates";
import { env } from "../env";
import { randomDigits, randomToken, sha256Hex } from "../crypto/encryption";
import {
  POLICY_COLUMNS,
  SCHEDULE_COLUMNS,
  advanceScheduleState,
  loadPolicy,
  loadPolicyForShare,
  loadSchedule,
  loadScheduleForUpdate,
  recordCheckinEvent,
  type ScheduleRow,
} from "../checkin/engine";
import { formatDateInZone } from "../checkin/schedule";
import { appUrl } from "../urls";

/**
 * Release state machine (backend-enforced).
 *
 *   release_cases: verification_pending → release_scheduled → released
 *                                  ↘ canceled / held / failed
 *
 * Rules enforced here:
 *  1. Disclosure happens ONLY in executeRelease(), after a fresh, row-locked
 *     re-evaluation of policy, schedule, verification and recipient permissions.
 *  2. A cancelled or otherwise non-'release_scheduled' case makes any queued
 *     execution job a no-op (compare-and-swap under row lock) — a stale job can
 *     never disclose content.
 *  3. If anything cannot be verified (missing keys, disabled policy, unmet
 *     verification, inconsistent state) the system fails CLOSED: no release.
 */

export type CaseState = "verification_pending" | "release_scheduled" | "released" | "canceled" | "held" | "failed";

export interface CaseRow {
  id: string;
  vaultId: string;
  scheduleId: string;
  policyId: string;
  state: CaseState;
  openedAt: Date;
  verificationDeadlineAt: Date | null;
  releaseAt: Date | null;
  canceledAt: Date | null;
  canceledBy: string | null;
  canceledReason: string | null;
  heldReason: string | null;
  releasedAt: Date | null;
  failureReason: string | null;
  policySnapshot: Record<string, unknown>;
  version: number;
}

export const CASE_COLUMNS = `id, vault_id, schedule_id, policy_id, state, opened_at, verification_deadline_at,
  release_at, canceled_at, canceled_by, canceled_reason, held_reason, released_at, failure_reason,
  policy_snapshot, version`;

export interface VerificationRow {
  id: string;
  caseId: string;
  method: "email_otp" | "trusted_contacts" | "evidence_review";
  status: "pending" | "satisfied" | "rejected";
  contactRecipientId: string | null;
  attestations: Array<Record<string, unknown>>;
  evidenceDocumentId: string | null;
  reviewerId: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  expiresAt: Date | null;
}

export interface PackageItem {
  type: "financial" | "digital" | "documents" | "properties" | "messages";
  id: string;
  title: string;
}

export async function recordReleaseEvent(
  tx: Queryable,
  caseId: string,
  event: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.q(
    `INSERT INTO release_events (case_id, event, details) VALUES ($1, $2, $3::jsonb)`,
    [caseId, event, JSON.stringify(details)],
  );
}

function verificationDeadlineFor(method: string): Date {
  const hours = method === "email_otp" ? 24 : method === "trusted_contacts" ? 72 : 168;
  return new Date(now().getTime() + hours * 3_600_000);
}

export interface OpenCaseResult {
  caseId: string;
  created: boolean;
}

/**
 * Open a verification-pending release case for a missed check-in (called by
 * the `checkin.begin_verification` job). Only ever opens when the release
 * policy is enabled; otherwise the schedule simply stays in its escalation
 * state with notifications.
 */
export async function openReleaseCase(
  scheduleId: string,
  dueIso: string,
): Promise<OpenCaseResult | null> {
  return withTransaction(async (tx) => {
    const schedule = await loadScheduleForUpdate(tx, scheduleId);
    if (!schedule) return null;
    if (schedule.status !== "active") return null;
    if (new Date(schedule.nextDueAt).toISOString() !== dueIso) return null; // superseded by a check-in
    if (!["overdue", "grace_period"].includes(schedule.currentState)) {
      const existing = await tx.q1<{ id: string }>(
        `SELECT id FROM release_cases WHERE schedule_id = $1 AND state IN ('verification_pending', 'release_scheduled', 'held')`,
        [scheduleId],
      );
      return existing ? { caseId: existing.id, created: false } : null;
    }
    if (!schedule.policyId) return null;

    const policy = await loadPolicyForShare(tx, schedule.policyId);
    if (!policy || !policy.enabled) {
      // No release configured: notify once and stop (fail closed by doing nothing).
      await recordCheckinEvent(tx, schedule.id, "release_blocked", { reason: "release_policy_disabled" });
      return null;
    }

    const advanced = await advanceScheduleState(
      tx,
      schedule.id,
      ["overdue", "grace_period"],
      "verification_pending",
      { dueIso },
    );
    if (!advanced) return null;

    const deadline = verificationDeadlineFor(policy.verificationMethod);
    const snapshot = {
      enabled: policy.enabled,
      verificationMethod: policy.verificationMethod,
      threshold: policy.trustedContactThreshold,
      delaySeconds: policy.delaySeconds,
      categories: policy.categories,
      version: policy.version,
      dueIso,
    };

    const caseRow = await tx.q1<{ id: string }>(
      `INSERT INTO release_cases
         (vault_id, schedule_id, policy_id, state, verification_deadline_at, policy_snapshot)
       VALUES ($1, $2, $3, 'verification_pending', $4, $5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [schedule.vaultId, schedule.id, policy.id, deadline, JSON.stringify(snapshot)],
    );

    if (!caseRow) {
      // Another worker won the race; restore consistency and surface the case.
      const existing = await tx.q1<{ id: string }>(
        `SELECT id FROM release_cases WHERE schedule_id = $1 AND state IN ('verification_pending', 'release_scheduled', 'held')`,
        [schedule.id],
      );
      return existing ? { caseId: existing.id, created: false } : null;
    }

    const caseId = caseRow.id;
    await tx.raw(`UPDATE checkin_schedules SET active_case_id = $2 WHERE id = $1`, [schedule.id, caseId]);
    await recordReleaseEvent(tx, caseId, "opened", snapshot);
    await recordCheckinEvent(tx, schedule.id, "case_opened", { caseId, dueIso });

    // Verification records per configured method.
    if (policy.verificationMethod === "trusted_contacts") {
      const contacts = await tx.q<{ id: string; email: string; displayName: string; linkedUserId: string | null }>(
        `SELECT id, email, display_name, linked_user_id
           FROM recipients
          WHERE vault_id = $1 AND status = 'active' AND linked_user_id IS NOT NULL`,
        [schedule.vaultId],
      );
      for (const contact of contacts) {
        const token = randomToken(24);
        await tx.q(
          `INSERT INTO verification_records (case_id, method, contact_recipient_id, token_hash, expires_at)
           VALUES ($1, 'trusted_contacts', $2, $3, $4)`,
          [caseId, contact.id, sha256Hex(token), deadline],
        );
        const verifyUrl = appUrl(`/verify-case/${token}`);
        await queueEmail(
          {
            to: contact.email,
            template: "escalation_notice",
            rendered: renderEmail("escalation_notice", {
              ownerName: (await ownerName(tx, schedule.userId)) ?? "An AfterKey user",
              detail:
                "They configured AfterKey to ask their trusted contacts to confirm when they cannot be reached. Nothing has been shared. Please only respond if you genuinely believe they are unavailable.",
              url: verifyUrl,
            }),
            userId: contact.linkedUserId,
            relatedType: "release_case",
            relatedId: caseId,
            dedupeKey: `esc:${caseId}:${contact.id}`,
          },
          tx,
        );
      }
      if (contacts.length === 0) {
        await recordReleaseEvent(tx, caseId, "no_eligible_contacts", {
          note: "verification requires active linked recipients; release remains blocked",
        });
      }
    } else if (policy.verificationMethod === "email_otp") {
      const otp = randomDigits(6);
      // The emailed code IS the token: store its hash so submitOwnerOtp can consume it.
      await issueToken(tx, schedule.userId, "release_otp", 24 * 3600, { caseId }, otp);
      await tx.q(
        `INSERT INTO verification_records (case_id, method, token_hash, expires_at)
         VALUES ($1, 'email_otp', $2, $3)`,
        [caseId, sha256Hex(otp), deadline],
      );
      const owner = await tx.q1<{ email: string; fullName: string | null }>(
        `SELECT email, full_name FROM users WHERE id = $1`,
        [schedule.userId],
      );
      if (owner) {
        await queueEmail(
          {
            to: owner.email,
            template: "release_otp",
            rendered: renderEmail("release_otp", {
              name: owner.fullName ?? "",
              code: otp,
              url: appUrl(`/checkins?case=${caseId}`),
              expiresIn: "24 hours",
            }),
            userId: schedule.userId,
            relatedType: "release_case",
            relatedId: caseId,
            dedupeKey: `otp:${caseId}`,
          },
          tx,
        );
      }
    } else {
      // evidence_review: a trusted contact submits evidence; an administrator reviews.
      const contacts = await tx.q<{ id: string; email: string; linkedUserId: string | null }>(
        `SELECT id, email, linked_user_id FROM recipients
          WHERE vault_id = $1 AND status = 'active' AND linked_user_id IS NOT NULL`,
        [schedule.vaultId],
      );
      for (const contact of contacts) {
        const token = randomToken(24);
        await tx.q(
          `INSERT INTO verification_records (case_id, method, contact_recipient_id, token_hash, expires_at)
           VALUES ($1, 'evidence_review', $2, $3, $4)`,
          [caseId, contact.id, sha256Hex(token), deadline],
        );
        await queueEmail(
          {
            to: contact.email,
            template: "escalation_notice",
            rendered: renderEmail("escalation_notice", {
              ownerName: (await ownerName(tx, schedule.userId)) ?? "An AfterKey user",
              detail:
                "Their configured procedure requires documentary evidence reviewed by AfterKey operations. Nothing has been shared. You may submit evidence from the secure page linked here.",
              url: appUrl(`/verify-case/${token}`),
            }),
            userId: contact.linkedUserId,
            relatedType: "release_case",
            relatedId: caseId,
            dedupeKey: `esc:${caseId}:${contact.id}`,
          },
          tx,
        );
      }
    }

    // Tell the owner immediately, with the cancellation path front and centre.
    const owner = await tx.q1<{ email: string; fullName: string | null }>(
      `SELECT email, full_name FROM users WHERE id = $1`,
      [schedule.userId],
    );
    if (owner) {
      await queueEmail(
        {
          to: owner.email,
          template: "release_scheduled",
          rendered: renderEmail("release_scheduled", {
            name: owner.fullName ?? "",
            releaseAtLabel: "the time shown in your check-in page",
            url: appUrl("/checkins"),
            consequence:
              "If you can still act, sign in now — cancelling requires your password and immediately stops every pending job.",
          }),
          userId: schedule.userId,
          relatedType: "release_case",
          relatedId: caseId,
          dedupeKey: `case_opened:${caseId}`,
        },
        tx,
      );
    }

    await recordAudit(
      {
        action: "release.case_opened",
        actorType: "system",
        targetType: "release_case",
        targetId: caseId,
        metadata: { scheduleId: schedule.id, method: policy.verificationMethod, dueIso },
      },
      tx,
    );

    return { caseId, created: true };
  });
}

async function ownerName(tx: Queryable, userId: string): Promise<string | null> {
  const row = await tx.q1<{ fullName: string | null }>(`SELECT full_name FROM users WHERE id = $1`, [userId]);
  return row?.fullName ?? null;
}

function verificationSatisfied(method: string, records: VerificationRow[], threshold: number): boolean {
  if (records.length === 0) return false;
  const satisfied = records.filter((r) => r.status === "satisfied");
  switch (method) {
    case "email_otp":
    case "evidence_review":
      return satisfied.length >= 1;
    case "trusted_contacts":
      return satisfied.length >= Math.max(1, threshold);
    default:
      return false;
  }
}

/** Re-read records and, when the configured procedure is met, schedule the release. */
export async function maybeScheduleRelease(caseId: string): Promise<{ scheduled: boolean; reason: string }> {
  return withTransaction(async (tx) => {
    const caseRow = await tx.q1<CaseRow>(`SELECT ${CASE_COLUMNS} FROM release_cases WHERE id = $1 FOR UPDATE`, [caseId]);
    if (!caseRow) return { scheduled: false, reason: "case_missing" };
    if (caseRow.state !== "verification_pending") return { scheduled: false, reason: `state_${caseRow.state}` };

    const policy = await loadPolicyForShare(tx, caseRow.policyId);
    if (!policy || !policy.enabled) {
      await blockCase(tx, caseRow, "policy_disabled_at_scheduling");
      return { scheduled: false, reason: "policy_disabled" };
    }

    const records = await tx.q<VerificationRow>(
      `SELECT id, case_id, method, status, contact_recipient_id, attestations, evidence_document_id,
              reviewer_id, reviewed_at, review_note, expires_at
         FROM verification_records WHERE case_id = $1`,
      [caseId],
    );
    if (!verificationSatisfied(policy.verificationMethod, records, policy.trustedContactThreshold)) {
      return { scheduled: false, reason: "verification_incomplete" };
    }

    const delay = Math.max(0, policy.delaySeconds ?? env().RELEASE_DELAY_SECONDS);
    const releaseAt = new Date(now().getTime() + delay * 1000);

    const updated = await tx.raw(
      `UPDATE release_cases
          SET state = 'release_scheduled', release_at = $2, version = version + 1
        WHERE id = $1 AND state = 'verification_pending'`,
      [caseId, releaseAt],
    );
    if (!updated.rowCount) return { scheduled: false, reason: "race_lost" };

    const advanced = await advanceScheduleState(
      tx,
      caseRow.scheduleId,
      ["verification_pending"],
      "release_scheduled",
      { caseId, releaseAt: releaseAt.toISOString() },
    );
    if (!advanced) {
      // Schedule refuses the transition: abort scheduling entirely (fail closed).
      throw new Error("schedule state could not advance to release_scheduled");
    }

    await recordReleaseEvent(tx, caseId, "release_scheduled", { releaseAt: releaseAt.toISOString(), delaySeconds: delay });
    await recordCheckinEvent(tx, caseRow.scheduleId, "release_scheduled", { caseId, releaseAt: releaseAt.toISOString() });

    await enqueue(
      {
        type: "release.execute",
        payload: { caseId },
        runAt: releaseAt,
        idempotencyKey: `release:${caseId}:v${(caseRow.version ?? 0) + 1}`,
        maxAttempts: 5,
      },
      tx,
    );

    await recordAudit(
      {
        action: "release.execution_scheduled",
        actorType: "system",
        targetType: "release_case",
        targetId: caseId,
        metadata: { releaseAt: releaseAt.toISOString(), delaySeconds: delay },
      },
      tx,
    );

    return { scheduled: true, reason: "scheduled" };
  });
}

async function blockCase(tx: Tx, caseRow: CaseRow, reason: string): Promise<void> {
  await tx.raw(
    `UPDATE release_cases SET state = 'failed', failure_reason = $2 WHERE id = $1 AND state IN ('verification_pending', 'release_scheduled')`,
    [caseRow.id, reason],
  );
  await recordReleaseEvent(tx, caseRow.id, "blocked", { reason });
  await recordCheckinEvent(tx, caseRow.scheduleId, "release_blocked", { caseId: caseRow.id, reason });
  await recordAudit({
    action: "release.blocked",
    actorType: "system",
    targetType: "release_case",
    targetId: caseRow.id,
    metadata: { reason },
  });

  // A failed case is terminal: return the schedule to active with a fresh due
  // date so check-ins keep recurring (nothing was released).
  const schedule = await loadScheduleForUpdate(tx, caseRow.scheduleId);
  if (schedule && ["verification_pending", "release_scheduled"].includes(schedule.currentState)) {
    const advanced = await advanceScheduleState(
      tx,
      schedule.id,
      [schedule.currentState],
      "active",
      { reason: `blocked:${reason}` },
      { type: "system" },
    );
    if (advanced) {
      const spec = {
        frequency: schedule.frequency,
        localTime: schedule.localTime,
        timezone: schedule.timezone,
        anchorDate: schedule.anchorDate,
      };
      const { nextDueAfter } = await import("../checkin/schedule");
      const nextDue = nextDueAfter(spec, now()) ?? new Date(now().getTime() + 86_400_000);
      await tx.raw(`UPDATE checkin_schedules SET next_due_at = $2 WHERE id = $1`, [schedule.id, nextDue]);
      await recordCheckinEvent(
        tx,
        schedule.id,
        "rescheduled",
        { nextDueAt: nextDue.toISOString(), reason: `blocked:${reason}` },
        { type: "system" },
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Verification submissions
 * ------------------------------------------------------------------ */

export async function submitOwnerOtp(userId: string, code: string): Promise<{ satisfied: boolean }> {
  return withTransaction(async (tx) => {
    // Locate this user's own pending OTP record (never another account's).
    const record = await tx.q1<VerificationRow>(
      `SELECT vr.id, vr.case_id, vr.method, vr.status, vr.contact_recipient_id, vr.attestations,
              vr.evidence_document_id, vr.reviewer_id, vr.reviewed_at, vr.review_note, vr.expires_at
         FROM verification_records vr
         JOIN release_cases c ON c.id = vr.case_id
         JOIN checkin_schedules s ON s.id = c.schedule_id
        WHERE vr.method = 'email_otp' AND vr.status = 'pending'
          AND s.user_id = $1
          AND c.state = 'verification_pending'
          AND (vr.expires_at IS NULL OR vr.expires_at > now())
        ORDER BY vr.created_at DESC
        LIMIT 1`,
      [userId],
    );
    if (!record) return { satisfied: false };

    const consumed = await consumeToken(tx, code.trim(), "release_otp");
    if (!consumed) return { satisfied: false };
    const meta = consumed.meta as { caseId?: string };
    if (meta.caseId && meta.caseId !== record.caseId) return { satisfied: false };

    await tx.raw(`UPDATE verification_records SET status = 'satisfied' WHERE id = $1 AND status = 'pending'`, [
      record.id,
    ]);
    await recordReleaseEvent(tx, record.caseId, "verification_otp_submitted", {});
    const caseRow = await loadCase(tx, record.caseId);
    if (caseRow) {
      await recordCheckinEvent(tx, caseRow.scheduleId, "verification_satisfied", { via: "email_otp" }, { type: "user", id: userId });
    }

    const result = await maybeScheduleReleaseInTx(tx, record.caseId);
    return { satisfied: result };
  });
}

async function loadCase(tx: Queryable, caseId: string): Promise<CaseRow | null> {
  return tx.q1<CaseRow>(`SELECT ${CASE_COLUMNS} FROM release_cases WHERE id = $1`, [caseId]);
}

/** Tx-local variant of maybeScheduleRelease (assumes caller holds the case lock). */
async function maybeScheduleReleaseInTx(tx: Tx, caseId: string): Promise<boolean> {
  const caseRow = await loadCase(tx, caseId);
  if (!caseRow || caseRow.state !== "verification_pending") return false;
  const policy = await loadPolicyForShare(tx, caseRow.policyId);
  if (!policy || !policy.enabled) {
    await blockCase(tx, caseRow, "policy_disabled_at_scheduling");
    return false;
  }
  const records = await tx.q<VerificationRow>(
    `SELECT id, case_id, method, status, contact_recipient_id, attestations, evidence_document_id,
            reviewer_id, reviewed_at, review_note, expires_at
       FROM verification_records WHERE case_id = $1`,
    [caseId],
  );
  if (!verificationSatisfied(policy.verificationMethod, records, policy.trustedContactThreshold)) return false;

  const delay = Math.max(0, policy.delaySeconds ?? env().RELEASE_DELAY_SECONDS);
  const releaseAt = new Date(now().getTime() + delay * 1000);
  const updated = await tx.raw(
    `UPDATE release_cases SET state = 'release_scheduled', release_at = $2, version = version + 1
      WHERE id = $1 AND state = 'verification_pending'`,
    [caseId, releaseAt],
  );
  if (!updated.rowCount) return false;

  const advanced = await advanceScheduleState(tx, caseRow.scheduleId, ["verification_pending"], "release_scheduled", {
    caseId,
    releaseAt: releaseAt.toISOString(),
  });
  if (!advanced) throw new Error("schedule state could not advance to release_scheduled");

  await recordReleaseEvent(tx, caseId, "release_scheduled", { releaseAt: releaseAt.toISOString(), delaySeconds: delay });
  await recordCheckinEvent(tx, caseRow.scheduleId, "release_scheduled", { caseId, releaseAt: releaseAt.toISOString() });
  await enqueue(
    {
      type: "release.execute",
      payload: { caseId },
      runAt: releaseAt,
      idempotencyKey: `release:${caseId}:v${(caseRow.version ?? 0) + 1}`,
      maxAttempts: 5,
    },
    tx,
  );
  await recordAudit({
    action: "release.execution_scheduled",
    actorType: "system",
    targetType: "release_case",
    targetId: caseId,
    metadata: { releaseAt: releaseAt.toISOString(), delaySeconds: delay },
  });
  return true;
}

/** Trusted contact attestation via a single-use token link. */
export async function submitContactAttestation(
  token: string,
  decision: "confirm_unavailable" | "cannot_confirm",
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ ok: boolean; reason?: string }> {
  return withTransaction(async (tx) => {
    // Contact tokens are stored hashed directly on verification_records.
    const record = await tx.q1<VerificationRow & { tokenHash: string | null; caseState: CaseState; ownerName: string | null; ownerEmail: string }>(
      `SELECT vr.id, vr.case_id, vr.method, vr.status, vr.contact_recipient_id, vr.attestations,
              vr.evidence_document_id, vr.reviewer_id, vr.reviewed_at, vr.review_note, vr.expires_at,
              vr.token_hash, c.state AS case_state, u.full_name AS owner_name, u.email AS owner_email
         FROM verification_records vr
         JOIN release_cases c ON c.id = vr.case_id
         JOIN checkin_schedules s ON s.id = c.schedule_id
         JOIN users u ON u.id = s.user_id
        WHERE vr.token_hash = $1 AND vr.status = 'pending'
          AND c.state = 'verification_pending'
          AND (vr.expires_at IS NULL OR vr.expires_at > now())`,
      [sha256Hex(token)],
    );
    if (!record) return { ok: false, reason: "invalid_or_used_token" };

    if (decision === "cannot_confirm") {
      await tx.raw(
        `UPDATE verification_records SET status = 'rejected', attestations = attestations || $2::jsonb WHERE id = $1`,
        [record.id, JSON.stringify([{ decision, at: now().toISOString() }])],
      );
      await recordReleaseEvent(tx, record.caseId, "contact_could_not_confirm", {});
      await recordAudit({
        action: "release.contact_declined",
        actorType: "recipient",
        actorId: record.contactRecipientId,
        targetType: "release_case",
        targetId: record.caseId,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      });
      return { ok: true };
    }

    await tx.raw(
      `UPDATE verification_records
          SET status = 'satisfied',
              token_hash = NULL,
              attestations = attestations || $2::jsonb
        WHERE id = $1`,
      [record.id, JSON.stringify([{ decision, at: now().toISOString() }])],
    );
    await recordReleaseEvent(tx, record.caseId, "contact_attested", {});
    await recordAudit({
      action: "release.contact_attested",
      actorType: "recipient",
      actorId: record.contactRecipientId,
      targetType: "release_case",
      targetId: record.caseId,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    const scheduled = await maybeScheduleReleaseInTx(tx, record.caseId);
    return { ok: true, reason: scheduled ? "scheduled" : undefined };
  });
}

/** Look up a pending verification record by raw contact token (for the verify page). */
export async function getContactVerificationView(token: string): Promise<{
  caseId: string;
  ownerName: string;
  method: string;
  openedAt: Date;
} | null> {
  const row = await db.q1<{ caseId: string; ownerName: string | null; method: string; openedAt: Date }>(
    `SELECT c.id AS case_id, u.full_name AS owner_name, vr.method, c.opened_at
       FROM verification_records vr
       JOIN release_cases c ON c.id = vr.case_id
       JOIN checkin_schedules s ON s.id = c.schedule_id
       JOIN users u ON u.id = s.user_id
      WHERE vr.token_hash = $1 AND vr.status = 'pending'
        AND c.state = 'verification_pending'
        AND (vr.expires_at IS NULL OR vr.expires_at > now())`,
    [sha256Hex(token)],
  );
  if (!row) return null;
  return { caseId: row.caseId, ownerName: row.ownerName ?? "An AfterKey user", method: row.method, openedAt: row.openedAt };
}

/** Administrator approves/rejects documentary evidence. */
export async function reviewEvidence(
  adminId: string,
  recordId: string,
  decision: "approve" | "reject",
  note: string,
): Promise<{ ok: boolean; scheduled?: boolean; reason?: string }> {
  return withTransaction(async (tx) => {
    const record = await tx.q1<VerificationRow>(
      `SELECT id, case_id, method, status, contact_recipient_id, attestations, evidence_document_id,
              reviewer_id, reviewed_at, review_note, expires_at
         FROM verification_records WHERE id = $1 FOR UPDATE`,
      [recordId],
    );
    if (!record) throw new ApiError(404, "not_found", "Verification record not found.");
    if (record.status !== "pending") throw new ApiError(409, "already_reviewed", "This record was already reviewed.");
    if (!record.evidenceDocumentId) {
      throw new ApiError(409, "no_evidence", "No evidence has been submitted for this record yet.");
    }

    await tx.raw(
      `UPDATE verification_records
          SET status = $2, reviewer_id = $3, reviewed_at = now(), review_note = $4
        WHERE id = $1`,
      [recordId, decision === "approve" ? "satisfied" : "rejected", adminId, note.slice(0, 1000)],
    );
    await recordReleaseEvent(tx, record.caseId, decision === "approve" ? "evidence_approved" : "evidence_rejected", {
      recordId,
      reviewedBy: adminId,
    });
    await recordAudit(
      {
        action: `release.evidence_${decision}`,
        actorType: "admin",
        actorId: adminId,
        targetType: "verification_record",
        targetId: recordId,
        metadata: { caseId: record.caseId, note: note.slice(0, 200) },
      },
      tx,
    );

    if (decision === "approve") {
      const scheduled = await maybeScheduleReleaseInTx(tx, record.caseId);
      return { ok: true, scheduled };
    }
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ *
 * Cancellation
 * ------------------------------------------------------------------ */

/** Internal: cancel any open case during a user check-in (no schedule advance). */
export async function cancelReleaseCaseForCheckin(
  tx: Tx,
  schedule: ScheduleRow,
  reason: string,
): Promise<string | null> {
  const caseRow = await tx.q1<CaseRow>(
    `SELECT ${CASE_COLUMNS} FROM release_cases
      WHERE schedule_id = $1 AND state IN ('verification_pending', 'release_scheduled', 'held')
      FOR UPDATE`,
    [schedule.id],
  );
  if (!caseRow) return null;

  await tx.raw(
    `UPDATE release_cases
        SET state = 'canceled', canceled_at = now(), canceled_reason = $2, canceled_by = $3
      WHERE id = $1 AND state IN ('verification_pending', 'release_scheduled', 'held')`,
    [caseRow.id, reason, schedule.userId],
  );
  const canceledJobs = await cancelJobsForPayload("release.execute", { caseId: caseRow.id }, tx);
  await recordReleaseEvent(tx, caseRow.id, "canceled", { reason, canceledJobs });
  await recordCheckinEvent(tx, schedule.id, "case_canceled", { caseId: caseRow.id, reason });
  return caseRow.id;
}

export interface CancelResult {
  caseId: string;
  canceledJobs: number;
  nextDueAt: Date;
}

/**
 * Owner- or admin-initiated cancellation. Resets the schedule to active with a
 * fresh due date and invalidates queued execution jobs — after this, a stale
 * job can only observe state 'canceled' and must do nothing.
 */
export async function cancelRelease(
  caseId: string,
  actor: { type: "user" | "admin"; id: string },
  reason: string,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<CancelResult> {
  await refreshClock(); // request-path entry: pick up the controlled clock offset
  return withTransaction(async (tx) => {
    const caseRow = await tx.q1<CaseRow>(`SELECT ${CASE_COLUMNS} FROM release_cases WHERE id = $1 FOR UPDATE`, [caseId]);
    if (!caseRow) throw new ApiError(404, "not_found", "Release case not found.");
    if (caseRow.state === "canceled") throw new ApiError(409, "already_canceled", "This release was already cancelled.");
    if (caseRow.state === "released") {
      throw new ApiError(409, "already_released", "This release has already completed and cannot be cancelled.");
    }

    await tx.raw(
      `UPDATE release_cases
          SET state = 'canceled', canceled_at = now(), canceled_reason = $2, canceled_by = $3
        WHERE id = $1 AND state IN ('verification_pending', 'release_scheduled', 'held')`,
      [caseRow.id, `${actor.type}: ${reason}`.slice(0, 300), actor.id],
    );

    const canceledJobs = await cancelJobsForPayload("release.execute", { caseId: caseRow.id }, tx);
    // Belt and braces: also cancel by idempotency key prefix.
    await tx.raw(
      `UPDATE jobs SET status = 'canceled', canceled_at = now(), updated_at = now()
        WHERE status = 'queued' AND idempotency_key LIKE $1`,
      [`release:${caseRow.id}:%`],
    );

    const schedule = await loadScheduleForUpdate(tx, caseRow.scheduleId);
    let nextDueAt = new Date(now().getTime() + 86_400_000);
    if (schedule) {
      const spec = {
        frequency: schedule.frequency,
        localTime: schedule.localTime,
        timezone: schedule.timezone,
        anchorDate: schedule.anchorDate,
      };
      const computed = (await import("../checkin/schedule")).nextDueAfter(spec, now());
      if (computed) nextDueAt = computed;

      await advanceScheduleState(
        tx,
        schedule.id,
        ["verification_pending", "release_scheduled", "grace_period", "overdue", "reminder_sent", "incident"],
        "active",
        { reason: `cancel:${reason}` },
        actor,
      );
      await tx.raw(
        `UPDATE checkin_schedules SET next_due_at = $2, active_case_id = NULL WHERE id = $1`,
        [schedule.id, nextDueAt],
      );
      await recordCheckinEvent(tx, schedule.id, "case_canceled", { caseId: caseRow.id, reason }, actor);
    }

    await recordReleaseEvent(tx, caseRow.id, "canceled", { reason, actor, canceledJobs });
    await recordAudit(
      {
        action: "release.canceled",
        actorType: actor.type,
        actorId: actor.id,
        targetType: "release_case",
        targetId: caseRow.id,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        metadata: { reason, canceledJobs },
      },
      tx,
    );

    // Notify the owner (always useful; also confirms the cancellation took effect).
    const owner = await tx.q1<{ email: string; fullName: string | null; id: string }>(
      `SELECT u.id, u.email, u.full_name FROM users u
         JOIN checkin_schedules s ON s.user_id = u.id
        WHERE s.id = $1`,
      [caseRow.scheduleId],
    );
    if (owner) {
      await queueEmail(
        {
          to: owner.email,
          template: "release_canceled",
          rendered: renderEmail("release_canceled", {
            name: owner.fullName ?? "",
            openedAtLabel: new Date(caseRow.openedAt).toUTCString(),
            actor: actor.type === "admin" ? "AfterKey operations" : "you",
            time: now().toUTCString(),
            url: appUrl("/checkins"),
          }),
          userId: owner.id,
          relatedType: "release_case",
          relatedId: caseRow.id,
          dedupeKey: `canceled:${caseRow.id}`,
        },
        tx,
      );
    }

    return { caseId: caseRow.id, canceledJobs, nextDueAt };
  });
}

/* ------------------------------------------------------------------ *
 * Execution — the ONLY place content becomes available
 * ------------------------------------------------------------------ */

export type ExecuteOutcome =
  | { result: "released"; deliveries: number }
  | { result: "blocked"; reason: string }
  | { result: "stale"; state: CaseState }
  | { result: "missing" };

export async function executeRelease(caseId: string): Promise<ExecuteOutcome> {
  return withTransaction(async (tx) => {
    const caseRow = await tx.q1<CaseRow>(`SELECT ${CASE_COLUMNS} FROM release_cases WHERE id = $1 FOR UPDATE`, [caseId]);
    if (!caseRow) return { result: "missing" };

    // 1. Stale-job guard: only a case still in release_scheduled may disclose.
    if (caseRow.state !== "release_scheduled") {
      await recordReleaseEvent(tx, caseId, "stale_execution_blocked", { state: caseRow.state });
      return { result: "stale", state: caseRow.state };
    }

    if (caseRow.releaseAt && new Date(caseRow.releaseAt).getTime() > now().getTime() + 1000) {
      // Clock moved backwards or manual invocation: re-schedule, do not release.
      await enqueue({ type: "release.execute", payload: { caseId }, runAt: new Date(caseRow.releaseAt) }, tx);
      return { result: "stale", state: caseRow.state };
    }

    // 2. Fresh policy evaluation under a shared row lock.
    const policy = await loadPolicyForShare(tx, caseRow.policyId);
    if (!policy || !policy.enabled) {
      await blockCase(tx, caseRow, "policy_disabled_at_execution");
      return { result: "blocked", reason: "policy_disabled" };
    }

    // 3. Schedule state re-check (user may have checked in while queued).
    const schedule = await loadScheduleForUpdate(tx, caseRow.scheduleId);
    if (!schedule || schedule.status !== "active") {
      await blockCase(tx, caseRow, "schedule_not_active");
      return { result: "blocked", reason: "schedule_inactive" };
    }
    if (schedule.currentState !== "release_scheduled" || schedule.activeCaseId !== caseRow.id) {
      await blockCase(tx, caseRow, `schedule_state_${schedule.currentState}`);
      return { result: "blocked", reason: "schedule_state_mismatch" };
    }
    if (schedule.lastCheckinAt && new Date(schedule.lastCheckinAt).getTime() > new Date(caseRow.openedAt).getTime()) {
      await blockCase(tx, caseRow, "user_checked_in");
      return { result: "blocked", reason: "checked_in" };
    }

    // 4. Verification must still satisfy the configured procedure.
    const records = await tx.q<VerificationRow>(
      `SELECT id, case_id, method, status, contact_recipient_id, attestations, evidence_document_id,
              reviewer_id, reviewed_at, review_note, expires_at
         FROM verification_records WHERE case_id = $1`,
      [caseId],
    );
    if (!verificationSatisfied(policy.verificationMethod, records, policy.trustedContactThreshold)) {
      await blockCase(tx, caseRow, "verification_not_satisfied");
      return { result: "blocked", reason: "verification" };
    }

    // 5. Build per-recipient packages from CURRENT permissions and CURRENT policy categories.
    const recipients = await tx.q<{ id: string; email: string; displayName: string; linkedUserId: string }>(
      `SELECT id, email, display_name, linked_user_id
         FROM recipients
        WHERE vault_id = $1 AND status = 'active' AND linked_user_id IS NOT NULL`,
      [caseRow.vaultId],
    );

    let deliveryCount = 0;
    for (const recipient of recipients) {
      const pkg = await buildPackageForRecipient(tx, caseRow.vaultId, recipient.id, policy.categories);
      if (pkg.length === 0) {
        await recordReleaseEvent(tx, caseId, "recipient_empty_package", { recipientId: recipient.id });
        continue;
      }
      await tx.raw(
        `INSERT INTO release_deliveries (case_id, vault_id, recipient_id, package, status, available_at)
         VALUES ($1, $2, $3, $4::jsonb, 'available', now())
         ON CONFLICT (case_id, recipient_id)
         DO UPDATE SET package = EXCLUDED.package, status = 'available', available_at = now()`,
        [caseId, caseRow.vaultId, recipient.id, JSON.stringify(pkg)],
      );

      const delivery = await tx.q1<{ id: string }>(
        `SELECT id FROM release_deliveries WHERE case_id = $1 AND recipient_id = $2`,
        [caseId, recipient.id],
      );
      if (delivery) {
        const access = await issueToken(tx, recipient.linkedUserId, "delivery_access", 7 * 24 * 3600, {
          deliveryId: delivery.id,
          caseId,
          recipientEmail: recipient.email,
        });
        await queueEmail(
          {
            to: recipient.email,
            template: "release_ready",
            rendered: renderEmail("release_ready", {
              senderName: (await ownerName(tx, schedule.userId)) ?? "Someone you know",
              itemCount: String(pkg.length),
              url: appUrl(`/access/${access.raw}`),
              expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toUTCString(),
            }),
            userId: recipient.linkedUserId,
            relatedType: "release_delivery",
            relatedId: delivery.id,
            dedupeKey: `ready:${delivery.id}`,
          },
          tx,
        );
        deliveryCount += 1;

        // Mark delivered messages with their delivery history.
        for (const item of pkg) {
          if (item.type === "messages") {
            await tx.raw(
              `UPDATE memories
                  SET delivery_history = delivery_history || $2::jsonb,
                      status = 'released'
                WHERE id = $1`,
              [item.id, JSON.stringify({ caseId, recipientId: recipient.id, at: now().toISOString() })],
            );
          }
        }
      }
    }

    // 6. Commit the transition — CAS under the lock we already hold.
    const caseUpdated = await tx.raw(
      `UPDATE release_cases SET state = 'released', released_at = now() WHERE id = $1 AND state = 'release_scheduled'`,
      [caseId],
    );
    if (!caseUpdated.rowCount) throw new Error("release case transition failed");

    const scheduleAdvanced = await advanceScheduleState(
      tx,
      schedule.id,
      ["release_scheduled"],
      "released",
      { caseId },
      { type: "system" },
    );
    if (!scheduleAdvanced) throw new Error("schedule transition to released failed");

    await tx.raw(`UPDATE checkin_schedules SET active_case_id = NULL WHERE id = $1`, [schedule.id]);

    // Roll the recurring cycle forward: the case is terminal, so the schedule
    // returns to active with its next due date. Without this the schedule
    // freezes in 'released' and maintenance never schedules another check-in.
    await advanceScheduleState(tx, schedule.id, ["released"], "active", { reason: "post_release" }, { type: "system" });
    const postSpec = {
      frequency: schedule.frequency,
      localTime: schedule.localTime,
      timezone: schedule.timezone,
      anchorDate: schedule.anchorDate,
    };
    const { nextDueAfter } = await import("../checkin/schedule");
    const postNextDue = nextDueAfter(postSpec, now()) ?? new Date(now().getTime() + 86_400_000);
    await tx.raw(`UPDATE checkin_schedules SET next_due_at = $2 WHERE id = $1`, [schedule.id, postNextDue]);
    await recordCheckinEvent(
      tx,
      schedule.id,
      "rescheduled",
      { nextDueAt: postNextDue.toISOString(), reason: "post_release" },
      { type: "system" },
    );

    await recordReleaseEvent(tx, caseId, "executed", { deliveries: deliveryCount, categories: policy.categories });
    await recordCheckinEvent(
      tx,
      schedule.id,
      "release_executed",
      { caseId, deliveries: deliveryCount },
      { type: "system" },
      `exec:${caseId}`,
    );
    await recordAudit({
      action: "release.executed",
      actorType: "system",
      targetType: "release_case",
      targetId: caseId,
      metadata: { deliveries: deliveryCount, categories: policy.categories },
    });

    return { result: "released", deliveries: deliveryCount };
  });
}

/**
 * Package builder: intersection of (a) the recipient's explicit grants,
 * (b) the policy's released categories, (c) items that are currently live.
 * Recipients never inherit another recipient's permissions.
 */
export async function buildPackageForRecipient(
  tx: Queryable,
  vaultId: string,
  recipientId: string,
  allowedCategories: string[],
): Promise<PackageItem[]> {
  const perms = await tx.q<{ category: PackageItem["type"]; itemId: string | null }>(
    `SELECT category, item_id FROM recipient_permissions WHERE recipient_id = $1`,
    [recipientId],
  );

  const items: PackageItem[] = [];
  const seen = new Set<string>();
  const push = (type: PackageItem["type"], id: string, title: string) => {
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    if (!allowedCategories.includes(type)) return;
    seen.add(key);
    items.push({ type, id, title });
  };

  const CATEGORY_LIMIT = 500;

  for (const perm of perms) {
    if (!allowedCategories.includes(perm.category)) continue;
    const category = perm.category;

    if (perm.itemId) {
      const row = await itemById(tx, category, vaultId, perm.itemId);
      if (row) push(category, row.id, row.title);
      continue;
    }

    // Category-wide grant: list live items of that category.
    if (category === "financial") {
      const rows = await tx.q<{ id: string; title: string }>(
        `SELECT id, COALESCE(nickname, institution) AS title FROM financial_records
          WHERE vault_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ${CATEGORY_LIMIT}`,
        [vaultId],
      );
      rows.forEach((r) => push("financial", r.id, r.title));
    } else if (category === "digital") {
      const rows = await tx.q<{ id: string; title: string }>(
        `SELECT id, service_name AS title FROM digital_accounts
          WHERE vault_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ${CATEGORY_LIMIT}`,
        [vaultId],
      );
      rows.forEach((r) => push("digital", r.id, r.title));
    } else if (category === "documents") {
      const rows = await tx.q<{ id: string; title: string }>(
        `SELECT id, title FROM documents
          WHERE vault_id = $1 AND deleted_at IS NULL AND archived_at IS NULL AND scan_status IN ('clean', 'skipped')
          ORDER BY uploaded_at DESC LIMIT ${CATEGORY_LIMIT}`,
        [vaultId],
      );
      rows.forEach((r) => push("documents", r.id, r.title));
    } else if (category === "properties") {
      const rows = await tx.q<{ id: string; title: string }>(
        `SELECT id, name AS title FROM properties
          WHERE vault_id = $1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ${CATEGORY_LIMIT}`,
        [vaultId],
      );
      rows.forEach((r) => push("properties", r.id, r.title));
    } else if (category === "messages") {
      // Only messages the owner explicitly marked for release are eligible.
      const rows = await tx.q<{ id: string; title: string }>(
        `SELECT id, title FROM memories
          WHERE vault_id = $1 AND archived_at IS NULL AND release_policy = 'on_release' AND consent_at IS NOT NULL
          ORDER BY updated_at DESC LIMIT ${CATEGORY_LIMIT}`,
        [vaultId],
      );
      rows.forEach((r) => push("messages", r.id, r.title));
    }
  }

  return items;
}

async function itemById(
  tx: Queryable,
  category: PackageItem["type"],
  vaultId: string,
  itemId: string,
): Promise<{ id: string; title: string } | null> {
  switch (category) {
    case "financial":
      return tx.q1<{ id: string; title: string }>(
        `SELECT id, COALESCE(nickname, institution) AS title FROM financial_records
          WHERE id = $1 AND vault_id = $2 AND archived_at IS NULL`,
        [itemId, vaultId],
      );
    case "digital":
      return tx.q1<{ id: string; title: string }>(
        `SELECT id, service_name AS title FROM digital_accounts WHERE id = $1 AND vault_id = $2 AND archived_at IS NULL`,
        [itemId, vaultId],
      );
    case "documents":
      return tx.q1<{ id: string; title: string }>(
        `SELECT id, title FROM documents
          WHERE id = $1 AND vault_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
            AND scan_status IN ('clean', 'skipped')`,
        [itemId, vaultId],
      );
    case "properties":
      return tx.q1<{ id: string; title: string }>(
        `SELECT id, name AS title FROM properties WHERE id = $1 AND vault_id = $2 AND archived_at IS NULL`,
        [itemId, vaultId],
      );
    case "messages":
      return tx.q1<{ id: string; title: string }>(
        `SELECT id, title FROM memories
          WHERE id = $1 AND vault_id = $2 AND archived_at IS NULL
            AND release_policy = 'on_release' AND consent_at IS NOT NULL`,
        [itemId, vaultId],
      );
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Queries for owners / admins / recipients
 * ------------------------------------------------------------------ */

export async function getActiveCaseForUser(userId: string): Promise<
  (CaseRow & { timezone: string; nextDueAt: Date; scheduleState: string }) | null
> {
  return db.q1<CaseRow & { timezone: string; nextDueAt: Date; scheduleState: string }>(
    `SELECT ${CASE_COLUMNS.split(",")
      .map((c) => `c.${c.trim()}`)
      .join(", ")},
            s.timezone, s.next_due_at, s.current_state AS schedule_state
       FROM release_cases c
       JOIN checkin_schedules s ON s.id = c.schedule_id
      WHERE s.user_id = $1 AND c.state IN ('verification_pending', 'release_scheduled', 'held')
      ORDER BY c.opened_at DESC
      LIMIT 1`,
    [userId],
  );
}

export async function getCaseForUser(userId: string, caseId: string): Promise<CaseRow | null> {
  return db.q1<CaseRow>(
    `SELECT ${CASE_COLUMNS.split(",")
      .map((c) => `c.${c.trim()}`)
      .join(", ")}
       FROM release_cases c
       JOIN checkin_schedules s ON s.id = c.schedule_id
      WHERE c.id = $1 AND s.user_id = $2`,
    [caseId, userId],
  );
}

export interface DeliverySummary {
  id: string;
  caseId: string;
  status: string;
  package: PackageItem[];
  availableAt: Date | null;
  viewedAt: Date | null;
  ownerName: string | null;
  releasedAt: Date | null;
}

export async function listDeliveriesForUser(userId: string): Promise<DeliverySummary[]> {
  return db.q<DeliverySummary>(
    `SELECT d.id, d.case_id, d.status, d.package, d.available_at, d.viewed_at,
            u.full_name AS owner_name, c.released_at
       FROM release_deliveries d
       JOIN recipients r ON r.id = d.recipient_id
       JOIN release_cases c ON c.id = d.case_id
       JOIN vaults v ON v.id = d.vault_id
       JOIN users u ON u.id = v.user_id
      WHERE r.linked_user_id = $1 AND c.state = 'released'
      ORDER BY d.available_at DESC`,
    [userId],
  );
}

export async function getDeliveryForUser(userId: string, deliveryId: string): Promise<
  (DeliverySummary & { recipientId: string; vaultId: string }) | null
> {
  return db.q1<DeliverySummary & { recipientId: string; vaultId: string }>(
    `SELECT d.id, d.case_id, d.status, d.package, d.available_at, d.viewed_at,
            d.recipient_id, d.vault_id,
            u.full_name AS owner_name, c.released_at
       FROM release_deliveries d
       JOIN recipients r ON r.id = d.recipient_id
       JOIN release_cases c ON c.id = d.case_id
       JOIN vaults v ON v.id = d.vault_id
       JOIN users u ON u.id = v.user_id
      WHERE d.id = $1 AND r.linked_user_id = $2 AND c.state = 'released'`,
    [deliveryId, userId],
  );
}

export async function markDeliveryViewed(deliveryId: string): Promise<void> {
  await db.raw(
    `UPDATE release_deliveries SET status = 'viewed', viewed_at = COALESCE(viewed_at, now()) WHERE id = $1`,
    [deliveryId],
  );
}

export { formatDateInZone, loadPolicy, loadSchedule, POLICY_COLUMNS, SCHEDULE_COLUMNS };
