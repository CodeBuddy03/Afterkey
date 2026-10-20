# AfterKey — delivery audit report

Date: 2026-10-20 · Scope: complete build-out of the AfterKey digital-legacy
platform in this workspace (application, database, security, tests, deployment
configuration, documentation).

## What was delivered

- **Full-stack application** — Next.js 15 App Router: marketing site, auth
  (signup / sign-in / MFA / verification / reset / recovery), authenticated vault
  (financial, digital accounts, documents, properties, recipients, messages),
  check-in scheduling, policy-verified release engine with recipient delivery,
  settings, onboarding, and a seven-section admin console.
- **Database** — PostgreSQL 16, six ordered checksum-guarded migrations
  (core, vault, check-in/release, ops, reference data, additive column).
- **Background worker** — durable Postgres job queue (idempotency keys,
  `FOR UPDATE SKIP LOCKED` claiming, exponential backoff, dead-lettering,
  stale-lock reclaim) driving reminders, escalations, release execution, email
  delivery and cleanup.
- **Security** — Argon2id passwords, hashed single-use purpose-scoped tokens,
  TOTP MFA, DB-backed HMAC-keyed rate limiting, same-origin enforcement,
  append-only audit log (DB trigger + sanitized metadata + HMAC'd IPs),
  per-vault DEKs wrapped by a server master key (documented, honest,
  non-zero-knowledge posture), production boot guards on dangerous configuration.
- **Deployment** — hardened Dockerfile with `web` / `worker` / `migrate`
  targets, `.dockerignore` (keeps `.env*` and local state out of layers),
  production compose example, health/readiness endpoints, GitHub Actions CI
  (quality, integration against Postgres, Playwright e2e).
- **Documentation** — README plus docs: setup, security architecture, deploy,
  production checklist, backup/recovery/key rotation, pricing, integrations,
  testing.
- **Premium dark glassmorphism redesign** — midnight canvas (`#07080C`),
  translucent glass surfaces with fine silver borders, restrained blue-violet
  accents, Inter UI font + Fraunces serif editorial accent, subtle motion with
  `prefers-reduced-motion` support. Reworked landing page (spec hero copy,
  how-it-works, benefit cards, security section, DB-driven pricing section
  with monthly/annual toggle, FAQ), glass navigation/footer, and the whole
  authenticated app + admin console via the shared token system.
- **Pricing** — plans are data (migration `007_pricing.sql`): Free $0,
  AfterKey Plus $4.99/mo · $39/yr, AfterKey Family $9.99/mo · $79/yr, with
  derived annual savings shown honestly. Free-plan entitlements (10 records,
  1 recipient) are enforced server-side with `403 plan_limit_reached`;
  paid activation is gated on verified server-side payment (no provider account
  yet — documented in docs/pricing.md, no fake checkout).

## Verification evidence

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean (0 errors, 0 warnings) |
| Unit + integration tests (Vitest, 11 files) | **90 passed** (63 unit incl. scheduling/crypto; 27 integration incl. billing entitlements) |
| E2E (Playwright, 3 specs, chromium + WebKit/iPhone 13) | **9 passed** |
| Admin console (browser) | all 7 sections render with live data: overview, users, releases, emails, support, audit, system (queue stats verified) |
| E2E lifecycle | register → email *actually delivered* (file adapter, read from mailbox) → link followed → verified → signed in → onboarding → signed out → protected routes redirect → wrong password rejected |
| Docker image (`web`/`worker`/`migrate` targets) | all three build; production web image smoke-tested: landing/health 200, `/api/ready` all-green (db, migrations, storage, email, worker, jobs) against real Postgres with production env guards satisfied |

Not verified (needs external services or accounts): real SMTP/Resend delivery,
S3 storage, Stripe checkout, MapTiler/Mapbox tiles, malware-scanner callback,
production TLS. Each degrades explicitly and is gated in
[docs/production-checklist.md](docs/production-checklist.md).

## Bugs found and fixed by the new test suites

1. **Check-in advance reminders never fired** (`src/lib/checkin/schedule.ts`).
   Reminder offsets were inverted (`d4: +4`): "4 days before" reminders computed
   *after* the due time, so the worker's late-reminder guard skipped every d4/d1
   reminder — users would only ever get overdue notices. Fixed to pre-due
   offsets; caught by unit tests against the documented UI labels.
2. **Negative "oldest queued job age"** in admin system stats: `min(run_at)`
   included future-scheduled jobs. Now computed over due jobs only
   (`oldestQueuedAgeSeconds`), with a regression test.
3. **App-wide label association broken** (`src/components/ui/inputs.tsx`):
   `Field`'s `htmlFor` never matched its input's id — every form field in the
   app lacked an accessible name. `Field` now wires id + `aria-describedby` into
   its control, including controls nested in wrapper elements. Surfaced by e2e
   selectors, fixed for all consumers.
4. **Docker image gaps**: no way to run the worker or migrations from the image
   (added `worker`/`migrate` targets); `.env*` would have entered build layers
   via `COPY . .` (added `.dockerignore`).
5. **Audit-route column mismatch** (`ip_hash`) and integration-suite traps
   (truncating FK reference table `plans`) — found and fixed while building the
   integration suite; the test setup now preserves bookkeeping and reference data.
6. **Container storage defect** — the readiness probe caught a non-writable
   `/app/var` in the production image (local-storage driver would fail uploads);
   the runner stage now pre-creates and chowns it, and deploy docs mount a
   volume there.

## Operational incidents resolved during build

- Docker Desktop engine restart left a stale port-forwarder resetting Postgres
  connections; containers were recreated and data verified intact. The dev
  database volume loss was recovered by re-running migrations and rebuilding the
  test databases (`npm run db:setup-test`).

## Known gaps / recommended next steps

1. **Billing**: plans publish with NULL prices by design; attach real Stripe
   price objects when the account exists.
2. **Malware scanning**: no scanner endpoint configured yet — either integrate
   one and set `MALWARE_SCAN_URL`, or formally accept `ALLOW_UNSCANNED_UPLOADS`.
3. **Email**: production needs SMTP or Resend credentials; deliverability,
   bounce and complaint handling untested against a real provider.
4. **Object storage**: S3/MinIO config pending; local driver is single-host only.
5. **Security review**: no external penetration test; the honest threat model
   (server-side key custody) is documented in docs/security-architecture.md.
6. **Scale/load**: queue and rate limiting are DB-backed and were exercised by
   tests, not load-tested.
7. **Localization**: user `locale` is stored; UI copy is English-only.
