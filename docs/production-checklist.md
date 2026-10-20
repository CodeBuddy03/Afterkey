# Production checklist

`src/lib/env.ts` enforces the first group at boot — production **refuses to
start** until they are resolved. The second group is operational and must be
verified before launch.

## Enforced at boot (hard gates)

- [ ] `AFTERKEY_ENCRYPTION_KEY` is a real 32-byte base64 key (the known dev key
      and its base64 prefix are rejected).
- [ ] `AFTERKEY_APP_SECRET` does not start with `dev-only`.
- [ ] `AFTERKEY_ENABLE_TEST_ROUTES` is unset/false (`/api/test/*` must not exist).
- [ ] `EMAIL_PROVIDER` is `smtp` or `resend` (the `file` provider stores mail in
      the database and sends nothing).
- [ ] `MALWARE_SCAN_URL` is set, or `ALLOW_UNSCANNED_UPLOADS=true` is set
      explicitly as a documented risk acceptance.
- [ ] `STORAGE_DRIVER=s3` has `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
      `S3_SECRET_ACCESS_KEY` (and endpoint when not AWS).

Generate the encryption key:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Operational (verify before launch)

- [ ] `APP_URL` is the public HTTPS origin; all links and origin checks depend on it.
- [ ] Migrations run as a controlled release step (`afterkey-migrate` target),
      never by the web/worker process.
- [ ] Web **and** worker are running and supervised (restart policies); a stale
      worker heartbeat turns `/api/ready` `degraded` — alert on it.
- [ ] Database: least-privilege runtime role, TLS or private network, scheduled
      backups with a tested restore (docs/backup-recovery.md).
- [ ] `AFTERKEY_ENCRYPTION_KEY` lives in a secret manager, **not** in the
      database backup, with rotation documented (docs/backup-recovery.md).
- [ ] SMTP/Resend credentials verified with a real delivered message; bounce/
      complaint handling configured at the provider.
- [ ] No seeded development accounts exist (seeded accounts can never
      authenticate in production, but do not ship them).
- [ ] Admin account created through `npm run db:create-admin` (or an audited
      equivalent), MFA enabled on admin accounts.
- [ ] Stripe keys configured or billing left in "plans published, pricing not
      configured" state deliberately.
- [ ] Logging: structured JSON logs shipped; `LOG_LEVEL=info` (no debug).
- [ ] HTTPS termination + security headers at the edge; HTTP-only cookie
      semantics inherited from Next.
- [ ] Rate limits reviewed for your traffic shape (`AUTH_LIMITS` in
      `src/lib/security/rate-limit.ts`).
- [ ] Backup/restore and key-rotation drills performed once on staging.
