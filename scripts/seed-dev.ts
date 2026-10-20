import { loadEnv } from "./lib/load-env";

loadEnv();

/**
 * Development / test seeding.
 *
 *   npm run db:seed:dev
 *
 * Creates the documented development fixtures:
 *   admin@afterkey.com / admin123   (role: admin)
 *   user@aftekey.com  / user123     (role: user — note the address spelling)
 *
 * SAFETY (docs/setup.md §Development accounts):
 *   - refuses to run when NODE_ENV=production (hard stop, checked twice)
 *   - requires AFTERKEY_ENABLE_DEV_SEED=true
 *   - passwords are hashed with Argon2id; plaintext lives only in this file's
 *     arguments and is never written to the database, logs or frontend code
 *   - both accounts are flagged is_seed_test_account + force_password_change;
 *     authentication for seeded accounts is BLOCKED whenever NODE_ENV=production
 *   - replaces credentials with: npm run db:create-admin -- --email=…
 */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "REFUSED: development seeds must never run in production.\n" +
        "If this database already contains seeded accounts, authentication for them is blocked;\n" +
        "create a real administrator with: npm run db:create-admin -- --email=you@example.com",
    );
    process.exit(1);
  }
  if (process.env.AFTERKEY_ENABLE_DEV_SEED !== "true") {
    console.error(
      "REFUSED: set AFTERKEY_ENABLE_DEV_SEED=true in .env.local to allow development seeding.",
    );
    process.exit(1);
  }

  const { withTransaction, closePool } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth/password");
  const { createVaultWithKeys, getVaultByUser } = await import("../src/lib/vault/service");
  const { env } = await import("../src/lib/env");
  env(); // validate configuration early

  const accounts = [
    {
      email: "admin@afterkey.com",
      password: "admin123",
      fullName: "Development Administrator",
      role: "admin" as const,
      timezone: "Africa/Nairobi",
    },
    {
      email: "user@aftekey.com",
      password: "user123",
      fullName: "Development User",
      role: "user" as const,
      timezone: "Africa/Nairobi",
    },
  ];

  const summary: string[] = [];

  for (const account of accounts) {
    const passwordHash = await hashPassword(account.password);
    const userId = await withTransaction(async (tx) => {
      const row = await tx.q1<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, role, status, email_verified_at,
                            is_seed_test_account, force_password_change, timezone)
         VALUES ($1, $2, $3, $4, 'active', now(), true, true, $5)
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               role = EXCLUDED.role,
               is_seed_test_account = true,
               force_password_change = true,
               status = 'active',
               email_verified_at = COALESCE(users.email_verified_at, now()),
               updated_at = now()
         RETURNING id`,
        [account.email, passwordHash, account.fullName, account.role, account.timezone],
      );
      if (!row) throw new Error(`Failed to seed ${account.email}`);
      const existingVault = await getVaultByUser(row.id, tx);
      if (!existingVault) await createVaultWithKeys(tx, row.id, "My Vault");
      await tx.raw(`INSERT INTO subscriptions (user_id, plan_slug) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, [
        row.id,
      ]);
      return row.id;
    });

    // Harmless sample data (clearly fictional) so the dev UI is not empty.
    if (account.role === "user") {
      await seedSampleData(userId);
      summary.push(`user   ${account.email} / ${account.password}  (test-only, must change password)`);
    } else {
      summary.push(`admin  ${account.email} / ${account.password}  (test-only, must change password)`);
    }
    void userId;
  }

  console.log("\nDevelopment accounts seeded (development only):\n");
  for (const line of summary) console.log(`  ${line}`);
  console.log(
    "\n  These are TEST-ONLY accounts: is_seed_test_account=true, force_password_change=true.\n" +
      "  They are blocked from authenticating when NODE_ENV=production.\n" +
      "  Replace them with: npm run db:create-admin -- --email=you@example.com\n",
  );

  await closePool();
}

async function seedSampleData(userId: string): Promise<void> {
  const { db, withTransaction } = await import("../src/lib/db");
  const { getVaultDek } = await import("../src/lib/vault/service");
  const { encryptText } = await import("../src/lib/crypto/encryption");

  const vault = await db.q1<{ id: string }>(`SELECT id FROM vaults WHERE user_id = $1`, [userId]);
  if (!vault) return;

  const count = await db.q1<{ n: number }>(`SELECT count(*)::int AS n FROM financial_records WHERE vault_id = $1`, [
    vault.id,
  ]);
  if ((count?.n ?? 0) > 0) return; // sample data already present

  const dek = await getVaultDek(vault.id);
  try {
    await withTransaction(async (tx) => {
      await tx.raw(
        `INSERT INTO financial_records (vault_id, category, institution, nickname, account_type, masked_identifier,
                                        provider_phone, reference_number, claim_instructions, notes, last_reviewed_on)
         VALUES ($1, 'bank', 'Sample Bank (fictional)', 'Everyday account', 'Current account', '**** 4021',
                 '+254 700 000000', 'REF-DEMO-1', $2, $3, CURRENT_DATE),
                ($1, 'life_insurance', 'Sample Life Assurers (fictional)', 'Family cover', 'Term life',
                 'Policy **** 771', '+254 700 000001', 'POL-DEMO-2', $4, NULL, CURRENT_DATE)`,
        [
          vault.id,
          encryptText("Call the number on your statement and quote the reference number.", dek),
          encryptText("Sample record created by the development seed — no real data.", dek),
          encryptText("Claim by calling the provider with the policy reference and a death certificate.", dek),
        ],
      );
      await tx.raw(
        `INSERT INTO properties (vault_id, name, property_type, address_line, city, country, ownership_reference, emergency_instructions)
         VALUES ($1, 'Sample Home (fictional)', 'primary', '12 Demo Lane', 'Nairobi', 'Kenya', 'Title Deed **** 99', $2)`,
        [vault.id, encryptText("Spare key is with the sample neighbour (fictional data).", dek)],
      );
      await tx.raw(
        `INSERT INTO memories (vault_id, title, body, intended_label, relationship, status, release_policy)
         VALUES ($1, 'A note for later', $2, 'Family', 'family', 'draft', 'manual')`,
        [vault.id, encryptText("Sample legacy message written by the development seed.", dek)],
      );
      await tx.raw(
        `INSERT INTO recipients (vault_id, display_name, email, relationship, status, created_by)
         VALUES ($1, 'Sample Contact (fictional)', 'sample-recipient@example.com', 'friend', 'invited', $2)`,
        [vault.id, userId],
      );
      await tx.raw(
        `INSERT INTO recipient_permissions (recipient_id, vault_id, category)
         SELECT id, vault_id, 'financial' FROM recipients WHERE vault_id = $1 AND email = 'sample-recipient@example.com'`,
        [vault.id],
      );
      await tx.raw(`UPDATE checkin_schedules SET next_due_at = now() + interval '20 days' WHERE user_id = $1`, [
        userId,
      ]);
    });
  } finally {
    dek.fill(0);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
