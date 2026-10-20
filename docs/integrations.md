# Integrations

All integrations degrade explicitly: the app never pretends an external service
is configured. What is missing is visible in configuration errors, `/api/ready`
and the admin system page.

## Email

`EMAIL_PROVIDER`:

- **`file`** (development) — messages are rendered and stored in
  `email_messages`; nothing leaves the machine. The e2e suite reads them via
  `/api/test/mailbox`, and the admin console shows the log. Rejected in production.
- **`smtp`** — `SMTP_URL` (e.g. `smtp://user:pass@host:587`, `smtps://` for TLS).
  Mailpit for local capture: `docker compose --profile dev up`, then
  `smtp://127.0.0.1:1025`. Production: SES/Postmark/etc.
- **`resend`** — `RESEND_API_KEY`; same rendered templates.

All providers share one outbox: `queueEmail` writes a durable row; the worker
delivers with retries. Templates cover verification, check-in reminders,
escalations, release notifications, invitations and support replies.

## Storage

`STORAGE_DRIVER`:

- **`local`** — `STORAGE_LOCAL_DIR` (default `./var/storage`). Fine for
  single-host deployments with a persistent volume.
- **`s3`** — `S3_ENDPOINT` (optional, for MinIO/R2), `S3_REGION`, `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Required when web and worker run on
  ephemeral filesystems.

Uploads are size-capped (`MAX_UPLOAD_BYTES`). Scanning: set `MALWARE_SCAN_URL`;
the app posts scan jobs there before content is considered clean, and production
boots only if scanning is configured or `ALLOW_UNSCANNED_UPLOADS=true` is an
explicit acknowledgement.

## Property map

`MAP_PROVIDER` = `nominatim` (self-hosted, no key) | `maptiler` | `mapbox`.
Set `MAP_GEOCODE_URL` / `MAP_GEOCODE_API_KEY` / `MAP_STYLE_URL` accordingly.
Without a provider, property records work but map tiles/geocoding are disabled.

## Billing (Stripe)

`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. Plans exist in the database
(migration 005: Free / Personal / Family / Premium Legacy) with **intentionally
NULL prices** — pricing is published only when real Stripe price objects are
attached. Subscriptions rows track plan assignment for every user; the free tier
works without Stripe configured.

## Test-only endpoints

`AFTERKEY_ENABLE_TEST_ROUTES=true` (blocked in production by boot guard):

| Route | Purpose |
| --- | --- |
| `/api/test/mailbox` | Read delivered messages (e2e verification/reset flows) |
| `/api/test/clock` | Inspect/advance the app clock (deadline testing) |
| `/api/test/tick` | Run one scheduler tick synchronously (deterministic e2e) |
