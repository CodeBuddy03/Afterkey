# Backup, restore and key rotation

## What must be backed up

| Asset | Why |
| --- | --- |
| PostgreSQL database | All records, jobs, audit log, key material (wrapped) |
| Object storage (S3 / `var/storage`) | Document and memory binaries |
| `AFTERKEY_ENCRYPTION_KEY` (secret manager, **separate**) | The only way to unwrap vault DEKs |

The database backup alone cannot decrypt vault content — but together with the
master key it can. Store the key with different access control and retention than
the backups themselves.

## Database backup / restore (example: local compose)

```bash
# Backup
docker exec afterkey-db pg_dump -U afterkey -Fc afterkey > afterkey.dump

# Restore into a fresh database
docker exec -i afterkey-db pg_restore -U afterkey -d afterkey --clean --if-exists afterkey.dump
```

In production, use managed snapshots **plus** `pg_dump -Fc` on a schedule; test a
restore into a scratch instance quarterly. After restore: run `npm run db:migrate`
(migrations are idempotent) and restart web + worker.

## Key rotation

Vault DEKs are wrapped by `AFTERKEY_ENCRYPTION_KEY`; rotation re-wraps every DEK
under the new key in one transaction:

```bash
# 1. Generate a new 32-byte key
NEW=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")

# 2. Re-wrap all vault DEKs (run with the OLD key in env, passing the new one)
npx tsx -e "
  import { loadEnv } from './scripts/lib/load-env'; loadEnv();
  const { rotateMasterKey } = await import('./src/lib/vault/service');
  const old = process.env.AFTERKEY_ENCRYPTION_KEY!;
  const res = await rotateMasterKey(old, process.env.NEW_KEY!);
  console.log('rotated', res.rotated);
"   # NEW_KEY=$NEW

# 3. Set AFTERKEY_ENCRYPTION_KEY=$NEW in the environment, restart web + worker
```

Keep the old key until a backup taken **before** the rotation has expired its
retention — otherwise pre-rotation backups become undecryptable.

Rotation does not touch `AFTERKEY_APP_SECRET` (HMAC only); rotating it changes
pseudonymized identifiers (audit IP hashes, rate-limit buckets, verifiers) —
coordinate: existing `recovery_verifier` values are derived from it and would
need re-enrollment.

## Recovery material

Owners may configure vault recovery material (`vault_keys.wrapped_dek_recovery`,
`recovery_verifier`). Verifiers are stored as HMACs; the wrapped recovery DEK is
only usable with the master key. Losing both the master key and all recovery
material means vault content is permanently unreadable — that is the honest cost
of encryption at rest.

## Drills

- Restore a backup into a scratch environment, run migrations, boot web + worker
  with a test master key, and verify `/api/ready` is `ok`.
- Verify one end-to-end check-in tick (`/api/test/tick`, test routes only) or by
  waiting for a scheduled job in the drill environment.
