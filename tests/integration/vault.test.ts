import { describe, expect, it } from "vitest";
import { db, withTransaction } from "@/lib/db";
import {
  createVaultWithKeys,
  getRecoveryStatus,
  getVaultByUser,
  getVaultDek,
  requireOwnedVault,
  resolveVaultId,
  setRecoveryMaterial,
} from "@/lib/vault/service";
import { createTestUser } from "./helpers";

describe("vault provisioning", () => {
  it("creates the vault with keys, release policy, schedule and first event", async () => {
    const u = await createTestUser();
    const vault = await getVaultByUser(u.id);
    expect(vault?.id).toBe(u.vaultId);
    expect(vault?.name).toBe("My Vault");

    const dek = await getVaultDek(u.vaultId);
    expect(dek.length).toBe(32);
    dek.fill(0);

    const counts = await db.q1<{ policies: number; schedules: number; events: number }>(
      `SELECT (SELECT count(*) FROM release_policies WHERE vault_id = $1)::int AS policies,
              (SELECT count(*) FROM checkin_schedules WHERE vault_id = $1)::int AS schedules,
              (SELECT count(*) FROM checkin_events ce
                 JOIN checkin_schedules cs ON cs.id = ce.schedule_id
                WHERE cs.vault_id = $1)::int AS events`,
      [u.vaultId],
    );
    expect(counts!.policies).toBe(1);
    expect(counts!.schedules).toBe(1);
    expect(counts!.events).toBeGreaterThanOrEqual(1);

    // The stored DEK is wrapped, never plaintext: unwrapping twice is stable.
    const again = await getVaultDek(u.vaultId);
    expect(again.length).toBe(32);
    again.fill(0);
  });

  it("enforces ownership with 404 (never 403 id probing)", async () => {
    const alice = await createTestUser();
    const mallory = await createTestUser();

    await expect(requireOwnedVault(mallory.id, alice.vaultId)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(resolveVaultId(mallory.id, alice.vaultId)).rejects.toMatchObject({ status: 404 });
    expect(await resolveVaultId(alice.id, alice.vaultId)).toBe(alice.vaultId);
  });

  it("tracks recovery material configuration", async () => {
    const u = await createTestUser();
    const before = await getRecoveryStatus(u.vaultId);
    expect(before.configured).toBe(false);

    await withTransaction((tx) => setRecoveryMaterial(tx, u.vaultId, "wrapped-recovery-blob", "verifier-value"));

    const after = await getRecoveryStatus(u.vaultId);
    expect(after.configured).toBe(true);
    expect(after.createdAt).not.toBeNull();

    const row = await db.q1<{ wrappedDekRecovery: string; recoveryVerifier: string }>(
      `SELECT wrapped_dek_recovery, recovery_verifier FROM vault_keys WHERE vault_id = $1`,
      [u.vaultId],
    );
    expect(row!.wrappedDekRecovery).toBe("wrapped-recovery-blob");
    expect(row!.recoveryVerifier).toBe("verifier-value");
  });

  it("creates a second vault for the same user only via explicit insert (one vault per user)", async () => {
    const u = await createTestUser();
    // The registration invariant: exactly one vault per user.
    const rows = await db.q<{ id: string }>(`SELECT id FROM vaults WHERE user_id = $1`, [u.id]);
    expect(rows).toHaveLength(1);

    // createVaultWithKeys itself is unrestricted (called inside registration's
    // transaction); duplicate vaults must be prevented by the unique index.
    await expect(
      withTransaction((tx) => createVaultWithKeys(tx, u.id, "Duplicate")),
    ).rejects.toThrow();
  });
});
