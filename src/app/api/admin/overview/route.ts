import { handleRoute, ok } from "@/lib/api/http";
import { requireAdmin } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { queueStats, workerHeartbeat } from "@/lib/jobs/queue";

/** GET /api/admin/overview — operator dashboard numbers. Admin only. */
export const GET = handleRoute(async () => {
  await requireAdmin();

  const counts = await db.q1<{
    users: number;
    usersUnverified: number;
    usersSuspended: number;
    vaults: number;
    recipientsActive: number;
    casesOpen: number;
    casesReleased: number;
    deliveriesAvailable: number;
    emailsQueued: number;
    emailsFailed: number;
    supportNew: number;
    exportsPending: number;
    deletionsPending: number;
  }>(
    `SELECT
       (SELECT count(*) FROM users)::int AS users,
       (SELECT count(*) FROM users WHERE status = 'unverified')::int AS users_unverified,
       (SELECT count(*) FROM users WHERE status = 'suspended')::int AS users_suspended,
       (SELECT count(*) FROM vaults)::int AS vaults,
       (SELECT count(*) FROM recipients WHERE status = 'active')::int AS recipients_active,
       (SELECT count(*) FROM release_cases WHERE state IN ('verification_pending', 'release_scheduled', 'held'))::int AS cases_open,
       (SELECT count(*) FROM release_cases WHERE state = 'released')::int AS cases_released,
       (SELECT count(*) FROM release_deliveries WHERE status = 'available')::int AS deliveries_available,
       (SELECT count(*) FROM email_messages WHERE status = 'queued')::int AS emails_queued,
       (SELECT count(*) FROM email_messages WHERE status = 'failed')::int AS emails_failed,
       (SELECT count(*) FROM support_requests WHERE status IN ('new', 'open'))::int AS support_new,
       (SELECT count(*) FROM data_export_requests WHERE status = 'pending')::int AS exports_pending,
       (SELECT count(*) FROM data_deletion_requests WHERE status = 'scheduled')::int AS deletions_pending`,
  );

  const [queue, heartbeat] = await Promise.all([queueStats(), workerHeartbeat()]);

  return ok({ counts: counts ?? {}, queue, heartbeat });
});

export const runtime = "nodejs";
