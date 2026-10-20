import { z } from "zod";
import { fail, handleRoute, ok, readJson } from "@/lib/api/http";
import { assertSameOrigin, currentIpAndAgent, requireRecentReauth, requireUser, requireVerified } from "@/lib/auth/guards";
import { db, withTransaction } from "@/lib/db";
import { getRecoveryStatus, getVaultDek, setRecoveryMaterial } from "@/lib/vault/service";
import {
  createRecoveryMaterial,
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  normalizePhrase,
  RECOVERY_PHRASE_BITS,
} from "@/lib/crypto/recovery";
import { recordAudit } from "@/lib/security/audit";
import { verifyPassword } from "@/lib/auth/password";
import { zPassword } from "@/lib/validation/common";
import { limiterKey, rateLimit } from "@/lib/security/rate-limit";

/**
 * Recovery phrase lifecycle.
 *
 *   GET    — status (never the phrase)
 *   POST   — generate a fresh 24-word phrase (shown ONCE; nothing stored yet)
 *   PATCH  — confirm the phrase: derives the key, stores the sealed copy
 *   DELETE — revoke recovery (password required)
 */

export const GET = handleRoute(async () => {
  const ctx = await requireUser();
  const vault = await db.q1<{ id: string }>(`SELECT id FROM vaults WHERE user_id = $1`, [ctx.user.id]);
  if (!vault) return ok({ configured: false });
  const status = await getRecoveryStatus(vault.id);
  return ok({ configured: status.configured, createdAt: status.createdAt, phraseBits: RECOVERY_PHRASE_BITS });
});

export const POST = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  requireRecentReauth(ctx, 30);
  const { ip, userAgent } = await currentIpAndAgent();
  await req.json().catch(() => null);

  const existing = await getRecoveryStatusOf(ctx.user.id);
  if (existing.configured) {
    return fail(
      409,
      "already_configured",
      "A recovery phrase is already set up. Revoke it first (with your password) before generating a new one.",
    );
  }

  const phrase = generateRecoveryPhrase();
  await recordAudit({
    action: "account.recovery_phrase_generated",
    actorType: "user",
    actorId: ctx.user.id,
    actorLabel: ctx.user.email,
    ip,
    userAgent,
    metadata: { note: "phrase displayed once; not stored" },
  });

  // Displayed exactly once, over TLS, to the authenticated owner.
  return ok({ phrase, bits: RECOVERY_PHRASE_BITS, words: 24 });
});

const confirmSchema = z.object({ phrase: z.string().min(10).max(600) });

export const PATCH = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  requireVerified(ctx);
  requireRecentReauth(ctx, 30);
  const { ip, userAgent } = await currentIpAndAgent();

  const limit = await rateLimit({ key: limiterKey(["recovery:confirm", ctx.user.id]), limit: 10, windowSeconds: 900 });
  if (!limit.ok) return fail(429, "rate_limited", "Too many attempts. Try again later.");

  const body = await readJson(req, confirmSchema);
  if (!isValidRecoveryPhrase(body.phrase)) {
    return fail(400, "invalid_phrase", "That does not look like a valid 24-word recovery phrase.");
  }

  const vault = await db.q1<{ id: string }>(`SELECT id FROM vaults WHERE user_id = $1`, [ctx.user.id]);
  if (!vault) return fail(404, "not_found", "Vault not found.");

  const dek = await getVaultDek(vault.id);
  try {
    const material = createRecoveryMaterial(dek, normalizePhrase(body.phrase));
    await withTransaction(async (tx) => {
      await setRecoveryMaterial(tx, vault.id, material.wrapped, material.verifier);
      await recordAudit(
        {
          action: "account.recovery_phrase_confirmed",
          actorType: "user",
          actorId: ctx.user.id,
          actorLabel: ctx.user.email,
          ip,
          userAgent,
        },
        tx,
      );
    });
  } finally {
    dek.fill(0);
  }

  return ok({ configured: true, message: "Recovery phrase confirmed. Keep your written copy somewhere safe." });
});

const revokeSchema = z.object({ password: zPassword() });

export const DELETE = handleRoute(async (req) => {
  assertSameOrigin(req);
  const ctx = await requireUser();
  const { ip, userAgent } = await currentIpAndAgent();
  const body = await readJson(req, revokeSchema);

  const row = await db.q1<{ passwordHash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [
    ctx.user.id,
  ]);
  if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, body.password))) {
    return fail(401, "invalid_password", "Your password is not correct.");
  }

  const vault = await db.q1<{ id: string }>(`SELECT id FROM vaults WHERE user_id = $1`, [ctx.user.id]);
  if (!vault) return fail(404, "not_found", "Vault not found.");

  await withTransaction(async (tx) => {
    await tx.raw(
      `UPDATE vault_keys SET wrapped_dek_recovery = NULL, recovery_verifier = NULL, recovery_rotated_at = now()
        WHERE vault_id = $1`,
      [vault.id],
    );
    await recordAudit(
      {
        action: "account.recovery_phrase_revoked",
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.email,
        ip,
        userAgent,
      },
      tx,
    );
  });

  return ok({ configured: false, message: "Recovery phrase revoked." });
});

async function getRecoveryStatusOf(userId: string): Promise<{ configured: boolean }> {
  const row = await db.q1<{ recoveryVerifier: string | null }>(
    `SELECT k.recovery_verifier FROM vault_keys k JOIN vaults v ON v.id = k.vault_id WHERE v.user_id = $1`,
    [userId],
  );
  return { configured: Boolean(row?.recoveryVerifier) };
}

export const runtime = "nodejs";
