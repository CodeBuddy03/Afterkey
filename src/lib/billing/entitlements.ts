import { db, type Queryable } from "../db";
import { ApiError } from "../api/http";

/**
 * Plan entitlements, enforced server-side.
 *
 * Free-tier limits make the Free plan real (10 records, 1 recipient); paid
 * limits follow the same table-driven configuration philosophy as pricing.
 * A missed payment never deletes data — entitlements degrade to Free and the
 * vault stays readable.
 */

export interface PlanLimitConfig {
  /** Max core records, or null for no explicit cap. */
  records: number | null;
  /** Max trusted recipients. */
  recipients: number;
  label: string;
}

export const PLAN_LIMITS: Record<string, PlanLimitConfig> = {
  free: { records: 10, recipients: 1, label: "Free" },
  personal: { records: null, recipients: 5, label: "AfterKey Plus" },
  family: { records: null, recipients: 10, label: "AfterKey Family" },
};

export const DEFAULT_LIMITS = PLAN_LIMITS.free!;

export interface SubscriptionSummary {
  planSlug: string;
  planLabel: string;
  status: string;
  provider: string;
}

/** Statuses that carry paid entitlements. Everything else degrades to Free. */
const ENTITLED_STATUSES = ["active", "trialing", "past_due"];

export async function getSubscription(
  userId: string,
  exec: Queryable = db,
): Promise<SubscriptionSummary> {
  const row = await exec.q1<{ planSlug: string; planName: string | null; status: string; provider: string }>(
    `SELECT s.plan_slug, p.name AS plan_name, s.status, s.provider
       FROM subscriptions s
       LEFT JOIN plans p ON p.slug = s.plan_slug
      WHERE s.user_id = $1`,
    [userId],
  );
  if (!row || !ENTITLED_STATUSES.includes(row.status)) {
    return { planSlug: "free", planLabel: DEFAULT_LIMITS.label, status: row?.status ?? "none", provider: row?.provider ?? "none" };
  }
  return {
    planSlug: row.planSlug,
    planLabel: PLAN_LIMITS[row.planSlug]?.label ?? row.planName ?? row.planSlug,
    status: row.status,
    provider: row.provider,
  };
}

export async function currentLimits(userId: string, exec: Queryable = db): Promise<PlanLimitConfig> {
  const sub = await getSubscription(userId, exec);
  return PLAN_LIMITS[sub.planSlug] ?? DEFAULT_LIMITS;
}

/** Count of core records across the vault record modules. */
export async function countCoreRecords(userId: string, exec: Queryable = db): Promise<number> {
  const row = await exec.q1<{ total: number }>(
    `SELECT
       (SELECT count(*) FROM financial_records r JOIN vaults v ON v.id = r.vault_id WHERE v.user_id = $1) +
       (SELECT count(*) FROM digital_accounts r JOIN vaults v ON v.id = r.vault_id WHERE v.user_id = $1) +
       (SELECT count(*) FROM properties r JOIN vaults v ON v.id = r.vault_id WHERE v.user_id = $1) +
       (SELECT count(*) FROM memories r JOIN vaults v ON v.id = r.vault_id WHERE v.user_id = $1) +
       (SELECT count(*) FROM documents r JOIN vaults v ON v.id = r.vault_id WHERE v.user_id = $1)::int AS total`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

export async function countRecipients(userId: string, exec: Queryable = db): Promise<number> {
  const row = await exec.q1<{ total: number }>(
    `SELECT count(*)::int AS total FROM recipients r JOIN vaults v ON v.id = r.vault_id WHERE v.user_id = $1`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

function planLimitError(what: string, limit: number, planLabel: string): ApiError {
  return new ApiError(
    403,
    "plan_limit_reached",
    `${planLabel} plans include up to ${limit} ${what}. Upgrade to add more, or remove an existing one.`,
    { upgrade: ["/pricing"] },
  );
}

/** Throws 403 plan_limit_reached when the user is at their plan's record cap. */
export async function assertRecordQuota(userId: string, exec: Queryable = db): Promise<void> {
  const limits = await currentLimits(userId, exec);
  if (limits.records === null) return;
  const used = await countCoreRecords(userId, exec);
  if (used >= limits.records) throw planLimitError("records", limits.records, limits.label);
}

/** Throws 403 plan_limit_reached when the user is at their plan's recipient cap. */
export async function assertRecipientQuota(userId: string, exec: Queryable = db): Promise<void> {
  const limits = await currentLimits(userId, exec);
  const used = await countRecipients(userId, exec);
  if (used >= limits.recipients) throw planLimitError("trusted recipients", limits.recipients, limits.label);
}
