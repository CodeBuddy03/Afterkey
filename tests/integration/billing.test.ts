import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  assertRecordQuota,
  assertRecipientQuota,
  currentLimits,
  getSubscription,
} from "@/lib/billing/entitlements";
import { createModule } from "@/lib/vault/modules";
import { financialSpec } from "@/lib/vault/module-specs";
import { createTestUser } from "./helpers";

async function addRecipient(vaultId: string, n: number): Promise<void> {
  await db.raw(
    `INSERT INTO recipients (vault_id, display_name, email) VALUES ($1, $2, $3)`,
    [vaultId, `Recipient ${n}`, `recipient-${n}-${Date.now()}@example.test`],
  );
}

describe("plan entitlements", () => {
  it("gives new accounts the Free limits (10 records, 1 recipient)", async () => {
    const u = await createTestUser();
    const sub = await getSubscription(u.id);
    expect(sub.planSlug).toBe("free");

    const limits = await currentLimits(u.id);
    expect(limits.records).toBe(10);
    expect(limits.recipients).toBe(1);
  });

  it("enforces the Free record cap with an actionable 403", async () => {
    const u = await createTestUser();
    for (let i = 0; i < 10; i += 1) {
      await createModule(financialSpec, u.id, { category: "bank", institution: `Bank ${i}` });
    }
    await expect(assertRecordQuota(u.id)).rejects.toMatchObject({
      status: 403,
      code: "plan_limit_reached",
    });

    // Upgrading lifts the cap without touching existing data.
    await db.raw(`UPDATE subscriptions SET plan_slug = 'personal' WHERE user_id = $1`, [u.id]);
    await expect(assertRecordQuota(u.id)).resolves.toBeUndefined();
  });

  it("enforces the recipient cap per plan", async () => {
    const u = await createTestUser();
    await addRecipient(u.vaultId, 1);
    await expect(assertRecipientQuota(u.id)).rejects.toMatchObject({ code: "plan_limit_reached" });

    await db.raw(`UPDATE subscriptions SET plan_slug = 'personal' WHERE user_id = $1`, [u.id]);
    for (let i = 2; i <= 5; i += 1) await addRecipient(u.vaultId, i);
    await expect(assertRecipientQuota(u.id)).rejects.toMatchObject({ code: "plan_limit_reached" });

    await db.raw(`UPDATE subscriptions SET plan_slug = 'family' WHERE user_id = $1`, [u.id]);
    await expect(assertRecipientQuota(u.id)).resolves.toBeUndefined();
  });

  it("degrades to Free when the subscription is canceled — data stays, entitlements do not", async () => {
    const u = await createTestUser();
    await db.raw(`UPDATE subscriptions SET plan_slug = 'personal', status = 'canceled' WHERE user_id = $1`, [u.id]);

    const sub = await getSubscription(u.id);
    expect(sub.planSlug).toBe("free");
    const limits = await currentLimits(u.id);
    expect(limits.records).toBe(10);
  });

  it("keeps entitlements through a past-due grace state", async () => {
    const u = await createTestUser();
    await db.raw(`UPDATE subscriptions SET plan_slug = 'personal', status = 'past_due' WHERE user_id = $1`, [u.id]);
    const sub = await getSubscription(u.id);
    expect(sub.planSlug).toBe("personal");
  });
});
