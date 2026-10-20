import { z } from "zod";
import { ApiError, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { cancelRelease, reviewEvidence } from "@/lib/release/engine";

/**
 * Admin release operations: inspect cases and their verification records,
 * cancel a release, and approve/reject documentary evidence (evidence_review
 * method). Admins can stop a release but never open one — opening requires
 * the owner's missed check-in plus the configured verification procedure.
 */

const actionSchema = z.object({
  caseId: z.string().uuid(),
  action: z.enum(["cancel", "review_evidence"]),
  recordId: z.string().uuid().optional(),
  decision: z.enum(["approve", "reject"]).optional(),
  note: z.string().trim().max(1000).optional(),
});

/** GET /api/admin/releases?state= */
export const GET = handleRoute(async (req) => {
  await requireAdmin();
  const url = new URL(req.url);
  const params: unknown[] = [];
  const where: string[] = ["1=1"];
  const state = url.searchParams.get("state");
  if (state) {
    params.push(state);
    where.push(`c.state = $${params.length}`);
  }
  params.push(100);

  const rows = await db.q<Record<string, unknown>>(
    `SELECT c.id, c.state, c.opened_at, c.verification_deadline_at, c.release_at, c.released_at,
            c.failure_reason, c.canceled_reason, c.version,
            u.email AS owner_email, u.full_name AS owner_name, s.timezone, s.frequency,
            p.verification_method, p.delay_seconds,
            COALESCE(vr.records, '[]'::jsonb) AS verification_records,
            COALESCE(d.deliveries, '[]'::jsonb) AS deliveries
       FROM release_cases c
       JOIN checkin_schedules s ON s.id = c.schedule_id
       JOIN users u ON u.id = s.user_id
       LEFT JOIN release_policies p ON p.id = c.policy_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
                  'id', r.id, 'method', r.method, 'status', r.status,
                  'evidenceDocumentId', r.evidence_document_id, 'reviewNote', r.review_note,
                  'attestations', r.attestations, 'expiresAt', r.expires_at)) AS records
           FROM verification_records r WHERE r.case_id = c.id
       ) vr ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
                  'id', d.id, 'recipientId', d.recipient_id, 'status', d.status,
                  'itemCount', jsonb_array_length(d.package), 'availableAt', d.available_at)) AS deliveries
           FROM release_deliveries d WHERE d.case_id = c.id
       ) d ON TRUE
      WHERE ${where.join(" AND ")}
      ORDER BY c.opened_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return ok({ items: rows, total: rows.length });
});

/** POST /api/admin/releases — cancel a case or decide on evidence. */
export const POST = handleRoute(async (req) => {
  const ctx = await requireAdmin();
  assertSameOrigin(req);
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, actionSchema);

  if (body.action === "cancel") {
    const result = await cancelRelease(
      body.caseId,
      { type: "admin", id: ctx.user.id },
      body.note ?? "Cancelled by administrator",
      { ip, userAgent },
    );
    return ok({ canceled: true, caseId: result.caseId, canceledJobs: result.canceledJobs, nextDueAt: result.nextDueAt });
  }

  if (!body.recordId || !body.decision) {
    throw new ApiError(400, "missing_fields", "Evidence review needs the verification record id and a decision.");
  }
  const result = await reviewEvidence(ctx.user.id, body.recordId, body.decision, body.note ?? "");
  if (!result.ok) {
    throw new ApiError(409, "review_failed", result.reason ?? "That verification record cannot be reviewed.");
  }
  return ok({ reviewed: true, decision: body.decision, scheduled: Boolean(result.scheduled) });
});

export const runtime = "nodejs";
