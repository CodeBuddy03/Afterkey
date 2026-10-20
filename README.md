# AfterKey

**Access Beyond Limits.** AfterKey is a digital-legacy platform: it keeps a person's
important records, accounts, documents and final messages organised in an encrypted
vault, and releases them to the right people — automatically, and only under the
conditions the owner set.

## What it does

- **Personal vault** — financial records, digital accounts, documents, properties,
  recipients and legacy messages, encrypted at rest (AES-256-GCM, per-vault data keys
  wrapped by a server master key).
- **Check-in schedules** — the owner checks in on a schedule (daily → yearly, IANA
  timezones, DST-safe). Missed check-ins escalate through reminder → overdue → grace
  period → verification.
- **Policy-verified release** — when verification succeeds (email OTP, trusted-contact
  threshold, or evidence review), a release case executes after a configurable delay:
  recipients get scoped, expiring access to exactly what the owner granted.
- **Recipient portal** — invited recipients authenticate with one-time invitations and
  see only the records shared with them, under audit.
- **Admin console** — users, releases, email outbox, support inbox and an append-only
  audit log.
- **Background worker** — a durable Postgres job queue drives reminders, escalations,
  release execution, email delivery and cleanup across restarts.

## Stack

Next.js 15 (App Router, route handlers) · React 19 · TypeScript · PostgreSQL 16 ·
Argon2id · otplib (TOTP) · Luxon · Zod · Tailwind · Vitest · Playwright.

Interface: a premium dark glassmorphism design system (midnight canvas,
translucent surfaces, restrained blue-violet accents, Inter + Fraunces) with
accessible contrast and reduced-motion support. Pricing is data-driven — see
[docs/pricing.md](docs/pricing.md).

## Quickstart (development)

```bash
npm ci
cp .env.example .env.local          # dev-safe values; replace before production
docker compose up -d db             # PostgreSQL 16 (add --profile dev for Mailpit)
npm run db:migrate                  # apply migrations to afterkey
npm run db:seed:dev                 # optional demo data
npm run dev                         # http://localhost:3001
npm run worker                      # background job worker (second terminal)
```

Create an admin: `npm run db:create-admin`.

Full environment reference: [docs/setup.md](docs/setup.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js web process |
| `npm run worker` | Background job worker (check-ins, releases, email) |
| `npm run db:migrate` | Apply migrations (checksum-guarded, ordered) |
| `npm run db:seed:dev` | Development seed data |
| `npm run db:create-admin` | Promote/create an administrator |
| `npm run db:setup-test` | Create + migrate `afterkey_test` / `afterkey_e2e` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Integration tests against `afterkey_test` |
| `npm run test:e2e` | Playwright E2E (self-managing server on :3100, `afterkey_e2e`) |
| `npm run check` | typecheck + lint + all Vitest suites |
| `npm run lint` / `npm run typecheck` | ESLint / tsc |

## Testing

- **Unit** (`tests/unit`) — pure logic: crypto, password policy, TOTP, validation,
  DST-safe check-in scheduling math.
- **Integration** (`tests/integration`) — real PostgreSQL: sessions, vault key
  material, single-use tokens, job queue semantics, durable rate limiting,
  append-only audit log.
- **E2E** (`e2e`) — real browser against the real server: registration → email
  verification through the delivered message → sign-in → sign-out, marketing pages,
  mobile layout.

Details, incl. how the E2E database is reset per run: [docs/testing.md](docs/testing.md).

## Security posture (summary)

AfterKey uses **server-side key custody**: vault content is encrypted at rest with
per-vault data keys wrapped by a server master key, which enables automated,
policy-verified release. This is **not zero-knowledge encryption** — the threat
model, trust boundaries and design rationale are documented in
[docs/security-architecture.md](docs/security-architecture.md). Production
boot-time guards (known dev secrets, test routes, unscanned uploads, file email
provider) are described in [docs/production-checklist.md](docs/production-checklist.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Environment variables, database lifecycle, dev tooling |
| [docs/security-architecture.md](docs/security-architecture.md) | Keys, sessions, tokens, audit, threat model |
| [docs/deploy.md](docs/deploy.md) | Docker targets, migrations, worker, health checks |
| [docs/production-checklist.md](docs/production-checklist.md) | Pre-launch gates and operational requirements |
| [docs/backup-recovery.md](docs/backup-recovery.md) | Backups, key rotation, account recovery material |
| [docs/integrations.md](docs/integrations.md) | Email, storage, maps, malware scanning, billing |
| [docs/pricing.md](docs/pricing.md) | Plans, data-driven prices, entitlements, billing gates |
| [docs/testing.md](docs/testing.md) | Test suites, fixtures, CI |
| [REPORT.md](REPORT.md) | Delivery audit: what was built, verified, and what remains |
