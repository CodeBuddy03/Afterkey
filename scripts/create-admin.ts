import crypto from "crypto";
import { loadEnv } from "./lib/load-env";

loadEnv();

/**
 * Create or replace a secure administrator (or reset any account's password).
 *
 *   npm run db:create-admin -- --email=you@example.com
 *   npm run db:create-admin -- --email=you@example.com --role=user
 *   npm run db:create-admin -- --email=you@example.com --reset-password
 *
 * Generates a strong one-time password printed to this terminal only, marks
 * the account to change it on first sign-in, and clears the test-account flag.
 * This is the documented replacement for the seeded development credentials.
 */

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function generatePassword(): string {
  // 24 URL-safe chars + digits: passes the password policy with margin.
  const raw = crypto.randomBytes(24).toString("base64url").replace(/[-_]/g, "x");
  return `Aa7${raw.slice(0, 21)}`;
}

async function main(): Promise<void> {
  const email = (arg("email") ?? "").trim().toLowerCase();
  const role = arg("role") === "user" ? "user" : "admin";
  const resetPassword = process.argv.includes("--reset-password");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error('Usage: npm run db:create-admin -- --email=you@example.com [--role=admin|user] [--reset-password]');
    process.exit(1);
  }

  const { db, withTransaction, closePool } = await import("../src/lib/db");
  const { hashPassword } = await import("../src/lib/auth/password");
  const { createVaultWithKeys, getVaultByUser } = await import("../src/lib/vault/service");

  const existing = await db.q1<{ id: string; role: string; isSeed: boolean }>(
    `SELECT id, role, is_seed_test_account AS "isSeed" FROM users WHERE email = $1`,
    [email],
  );
  if (existing && existing.role === "admin" && role === "admin" && !resetPassword && !existing.isSeed) {
    console.log(`${email} is already an administrator. Pass --reset-password to rotate the password.`);
    await closePool();
    return;
  }

  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  await withTransaction(async (tx) => {
    const row = await tx.q1<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, status, email_verified_at,
                          is_seed_test_account, force_password_change)
       VALUES ($1, $2, $3, $4, 'active', now(), false, true)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             is_seed_test_account = false,
             force_password_change = true,
             status = 'active',
             email_verified_at = COALESCE(users.email_verified_at, now()),
             updated_at = now()
       RETURNING id`,
      [email, passwordHash, "Account Owner", role],
    );
    if (!row) throw new Error("Could not create the account");
    const vault = await getVaultByUser(row.id, tx);
    if (!vault) await createVaultWithKeys(tx, row.id, "My Vault");
    await tx.raw(`INSERT INTO subscriptions (user_id, plan_slug) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, [row.id]);
    await tx.raw(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [row.id]);
    await tx.raw(
      `INSERT INTO audit_events (actor_type, actor_label, action, target_type, target_id, metadata)
       VALUES ('system', 'create-admin script', 'admin.credentials_created', 'user', $1,
               jsonb_build_object('role', $2::text, 'passwordReset', $3::boolean))`,
      [row.id, role, Boolean(existing)],
    );
  });

  console.log("\nAdministrator credentials created:\n");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  role:     ${role}`);
  console.log("\n  This password is shown ONCE. The account must change it at first sign-in.\n");

  await closePool();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
