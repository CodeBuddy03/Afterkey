# Deployment

AfterKey runs as **two processes** against one PostgreSQL database:

1. **Web** — Next.js standalone server (route handlers + UI).
2. **Worker** — `src/worker/run.ts` (check-in escalation, release execution,
   email delivery, cleanup). Without it, scheduled work never happens.

Migrations are a **controlled release step**, never executed by the web process.

## Docker image targets

`Dockerfile` defines three targets (`.dockerignore` keeps `.env*`, `var/` and
test artifacts out of build context):

```bash
docker build --target worker  -t afterkey-web .      # default target: web server
docker build --target worker  -t afterkey-worker .
docker build --target migrate -t afterkey-migrate .
```

- `runner` (default): non-root `nextjs` user, standalone output, port 3000.
- `worker`: same build tree, runs `npx tsx src/worker/run.ts` as non-root.
- `migrate`: one-off migration runner.

## Release sequence

```bash
# 1. Migrations (idempotent; order + checksums enforced)
docker run --rm --env-file .env.production afterkey-migrate

# 2. Web + worker
docker compose -f docker-compose.prod.yml up -d
```

## Example production compose

```yaml
services:
  web:
    image: afterkey-web
    env_file: [.env.production]
    environment:
      NODE_ENV: production
      PORT: "3000"
    ports: ["3000:3000"]
    volumes:
      # Local-storage driver (STORAGE_DRIVER=local) writes to /app/var — mount
      # a persistent volume here on single-host deployments, or use S3.
      - afterkey_var:/app/var
    depends_on:
      db: { condition: service_healthy }
    restart: unless-stopped

  worker:
    image: afterkey-worker
    env_file: [.env.production]
    environment:
      NODE_ENV: production
    depends_on:
      db: { condition: service_healthy }
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: afterkey
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: afterkey
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U afterkey -d afterkey"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  afterkey_var:
```

Run migrations from the release job (or a temporary `migrate` service), not from
`web` or `worker`.

## Health checks

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health` | Liveness only — process is up. |
| `GET /api/ready` | Readiness: database reachable, worker heartbeat fresh, audit writable; reports `degraded` with reasons otherwise. |

Point orchestrator readiness probes at the ready endpoint and liveness at
`/api/health`. Alert on `degraded` (e.g. stale worker heartbeat means check-ins
are not being processed).

## Environment

Set `NODE_ENV=production` and review every variable in docs/setup.md against
docs/production-checklist.md. Required before boot succeeds in production:
real `AFTERKEY_ENCRYPTION_KEY` / `AFTERKEY_APP_SECRET`, an SMTP or Resend email
provider, malware scanning (or explicit acknowledgement), and S3 credentials when
`STORAGE_DRIVER=s3` (object storage is required if web and worker run on
ephemeral filesystems — local-disk storage only suits single-host persistent
volumes).

## Backups and key custody

Back up the database on a schedule and store `AFTERKEY_ENCRYPTION_KEY` in a
secret manager **separately from the database backup** — anyone holding both can
read every vault. Rotation procedure: docs/backup-recovery.md.
