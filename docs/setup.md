# Setup

## Prerequisites

- Node.js ≥ 20.9 (see `engines` in package.json)
- PostgreSQL 16 (or `docker compose up -d db`)
- Optional: Mailpit for local SMTP capture (`docker compose --profile dev up`)

## Environment

Copy `.env.example` → `.env.local`. Existing process environment always wins.
All variables are validated at boot by `src/lib/env.ts`; the app refuses to start
with an invalid configuration.

| Variable | Notes |
| --- | --- |
| `APP_URL` | Public origin. Used for email links and same-origin enforcement. |
| `DATABASE_URL` | Postgres connection string (least-privilege role in production). |
| `AFTERKEY_ENCRYPTION_KEY` | Base64 of exactly 32 bytes. Wraps vault data keys. **Rotate via docs/backup-recovery.md.** |
| `AFTERKEY_APP_SECRET` | ≥ 16 chars. HMAC for IP pseudonymization and verifiers. Never encrypts. |
| `EMAIL_PROVIDER` | `file` (DB outbox), `smtp` (`SMTP_URL`), or `resend` (`RESEND_API_KEY`). |
| `EMAIL_FROM` / `EMAIL_ADMIN_ADDRESS` | Sender identity / admin notifications. |
| `STORAGE_DRIVER` | `local` (`STORAGE_LOCAL_DIR`) or `s3` (endpoint/region/bucket/keys). |
| `MALWARE_SCAN_URL` | Upload scan endpoint. In production: set it, or explicitly set `ALLOW_UNSCANNED_UPLOADS=true`. |
| `MAP_PROVIDER`, `MAP_GEOCODE_URL`, `MAP_STYLE_URL`, `MAP_GEOCODE_API_KEY` | Property map (Nominatim/MapTiler/Mapbox). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Billing (plans exist; prices are not invented until configured). |
| `WORKER_POLL_MS`, `WORKER_BATCH` | Worker cadence and batch size. |
| `RELEASE_DELAY_SECONDS` | Minimum delay between release approval and execution. |
| `MAX_UPLOAD_BYTES` | Upload size cap. |
| `SESSION_TTL_DAYS` | Session lifetime (sliding). |
| `AFTERKEY_ENABLE_TEST_ROUTES` | Enables `/api/test/*` (mailbox, clock, tick). **Blocked in production.** |
| `AFTERKEY_ENABLE_DEV_SEED` | Dev seed affordances. **Blocked in production.** |

Development ships with an explicit, well-known dev key; production refuses to boot
with it (see docs/production-checklist.md).

## Database lifecycle

```bash
npm run db:migrate            # afterkey (ordered, checksum-guarded)
npm run db:seed:dev           # optional demo data
npm run db:create-admin       # admin account (prompts)
npm run db:setup-test         # creates + migrates afterkey_test and afterkey_e2e
```

Migrations live in `migrations/*.sql`, run in filename order inside transactions,
and are recorded with a SHA-256 checksum in `schema_migrations`. Editing an applied
migration is refused (checksum mismatch) — add a new file instead. Set
`MIGRATE_ALLOW_DRIFT=1` only in development when you must edit and re-apply.

`--database=<name>` targets a sibling database on the same server
(e.g. `tsx scripts/migrate.ts --database=afterkey_test`).

## Running

```bash
npm run dev      # web on :3001
npm run worker   # background worker (check-ins, releases, email, cleanup)
```

The web app and the worker are separate processes sharing one database queue.
Both are required for a working system: without the worker, check-in reminders,
escalations and releases never run.

## Local infrastructure

```bash
docker compose up -d db                  # postgres:16 on localhost:5432
docker compose --profile dev up          # + Mailpit (SMTP :1025, UI :8025)
```

With Mailpit, set `EMAIL_PROVIDER=smtp` and `SMTP_URL=smtp://127.0.0.1:1025`.
With `EMAIL_PROVIDER=file`, messages are stored in the `email_messages` table and
inspected at `/api/test/mailbox` (test routes only) or in the admin email log.
