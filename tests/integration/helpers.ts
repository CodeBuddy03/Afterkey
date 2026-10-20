import { randomUUID } from "node:crypto";
import { withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createVaultWithKeys } from "@/lib/vault/service";

/** A fully provisioned test account: user row + vault (keys, policy, schedule). */
export interface TestUser {
  id: string;
  email: string;
  password: string;
  vaultId: string;
  role: "user" | "admin";
}

export interface TestUserOptions {
  password?: string;
  status?: "unverified" | "active" | "suspended" | "deletion_pending" | "deleted";
  role?: "user" | "admin";
  /** Set false to leave email_verified_at NULL (default: verified). */
  verified?: boolean;
}

/**
 * Creates a user exactly the way the register route does (password hash via
 * Argon2, vault with wrapped DEK, release policy, check-in schedule, free
 * subscription) so service-layer tests run against realistic rows.
 */
export async function createTestUser(opts: TestUserOptions = {}): Promise<TestUser> {
  const password = opts.password ?? "Correct-Horse-42!";
  const email = `it-${randomUUID()}@example.test`;
  const passwordHash = await hashPassword(password);

  const created = await withTransaction(async (tx) => {
    const user = await tx.q1<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, timezone, status, role, email_verified_at)
       VALUES ($1, $2, $3, 'Africa/Nairobi', $4, $5, $6)
       RETURNING id, email`,
      [
        email,
        passwordHash,
        "Integration Tester",
        opts.status ?? "active",
        opts.role ?? "user",
        opts.verified === false ? null : new Date(),
      ],
    );
    if (!user) throw new Error("Failed to create test user");

    const vault = await createVaultWithKeys(tx, user.id);
    await tx.raw(`INSERT INTO subscriptions (user_id, plan_slug) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, [
      user.id,
    ]);

    return { id: user.id, email: user.email, vaultId: vault.id };
  });

  return { ...created, password, role: opts.role ?? "user" };
}
