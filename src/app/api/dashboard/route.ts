import { handleRoute, ok } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { vaultIdOf } from "@/lib/vault/modules";
import { loadScheduleByUser, loadPolicyByVault } from "@/lib/checkin/engine";
import { getActiveCaseForUser, listDeliveriesForUser } from "@/lib/release/engine";

/**
 * Dashboard summary: counts, next check-in, open case, recent activity.
 * Everything is aggregated server-side from the caller's own vault — no
 * client-side guessing, no cross-vault leakage.
 */
export const GET = handleRoute(async () => {
  const ctx = await requireUser();
  const vaultId = await vaultIdOf(ctx.user.id);

  const countsRow = await db.q1<{
    financial: number;
    digital: number;
    properties: number;
    messages: number;
    documents: number;
    recipients: number;
    recipientsActive: number;
    documentsBytes: number;
  }>(
    `SELECT
       (SELECT count(*) FROM financial_records WHERE vault_id = $1 AND archived_at IS NULL)::int AS financial,
       (SELECT count(*) FROM digital_accounts WHERE vault_id = $1 AND archived_at IS NULL)::int AS digital,
       (SELECT count(*) FROM properties WHERE vault_id = $1 AND archived_at IS NULL)::int AS properties,
       (SELECT count(*) FROM memories WHERE vault_id = $1 AND archived_at IS NULL)::int AS messages,
       (SELECT count(*) FROM documents WHERE vault_id = $1 AND archived_at IS NULL AND deleted_at IS NULL)::int AS documents,
       (SELECT count(*) FROM recipients WHERE vault_id = $1)::int AS recipients,
       (SELECT count(*) FROM recipients WHERE vault_id = $1 AND status = 'active')::int AS recipients_active,
       COALESCE((SELECT sum(size_bytes) FROM documents
                  WHERE vault_id = $1 AND archived_at IS NULL AND deleted_at IS NULL), 0)::bigint AS documents_bytes`,
    [vaultId],
  );

  const schedule = await loadScheduleByUser(ctx.user.id);
  const policy = await loadPolicyByVault(vaultId);
  const activeCase = await getActiveCaseForUser(ctx.user.id);
  const deliveries = await listDeliveriesForUser(ctx.user.id);

  // Onboarding progress: derived from real data, never faked.
  const steps = [
    { key: "profile", label: "Confirm your email", done: Boolean(ctx.user.emailVerifiedAt) },
    {
      key: "records",
      label: "Add your first record",
      done: (countsRow?.financial ?? 0) + (countsRow?.digital ?? 0) > 0,
    },
    { key: "documents", label: "Store a document", done: (countsRow?.documents ?? 0) > 0 },
    { key: "recipient", label: "Invite a trusted recipient", done: (countsRow?.recipients ?? 0) > 0 },
    {
      key: "schedule",
      label: "Set your check-in schedule",
      done: Boolean(schedule),
    },
    {
      key: "recovery",
      label: "Set up account recovery",
      done: Boolean(ctx.user.mfaEnabled),
    },
  ];

  const recentActivity = await db.q<{ action: string; occurredAt: Date; actorLabel: string | null }>(
    `SELECT action, occurred_at, actor_label
       FROM audit_events
      WHERE actor_id = $1
      ORDER BY occurred_at DESC
      LIMIT 8`,
    [ctx.user.id],
  );

  return ok({
    counts: countsRow ?? {},
    schedule: schedule
      ? {
          id: schedule.id,
          frequency: schedule.frequency,
          timezone: schedule.timezone,
          localTime: schedule.localTime,
          graceHours: schedule.graceHours,
          status: schedule.status,
          currentState: schedule.currentState,
          nextDueAt: schedule.nextDueAt,
          lastCheckinAt: schedule.lastCheckinAt,
        }
      : null,
    policy: policy
      ? { enabled: policy.enabled, verificationMethod: policy.verificationMethod }
      : null,
    activeCase: activeCase
      ? {
          id: activeCase.id,
          state: activeCase.state,
          openedAt: activeCase.openedAt,
          releaseAt: activeCase.releaseAt,
          verificationDeadlineAt: activeCase.verificationDeadlineAt,
        }
      : null,
    deliveries: deliveries.map((d) => ({
      id: d.id,
      caseId: d.caseId,
      status: d.status,
      ownerName: d.ownerName,
      availableAt: d.availableAt,
      itemCount: d.package.length,
    })),
    onboarding: { steps, completed: steps.filter((s) => s.done).length, total: steps.length },
    recentActivity,
  });
});

export const runtime = "nodejs";
