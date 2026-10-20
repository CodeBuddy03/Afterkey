# Security architecture

This document states the design honestly. AfterKey provides **encryption at rest
with server-side key custody** to enable automated, policy-verified release. It is
**not zero-knowledge**: the server can decrypt vault content, because a machine
that could never see the content could not release it on the owner's behalf after
death or incapacity. Anyone evaluating AfterKey must weigh this trade-off
explicitly.

## Key hierarchy

```
AFTERKEY_ENCRYPTION_KEY (32 bytes, base64; server-held)
        │  wraps (v1 format: iv · tag · ciphertext)
        ▼
  Vault DEK (random 32 bytes, one per vault, never stored unwrapped)
        │  encrypts (AES-256-GCM, AAD binds record id/type)
        ▼
  Vault content (records, documents metadata, messages)
```

- `AFTERKEY_APP_SECRET` is **HMAC-only**: IP pseudonymization (audit log, sessions,
  rate-limit buckets) and verifier tokens. It never encrypts.
- Vault DEKs are wrapped at creation (`createVaultWithKeys`) inside the
  registration transaction — no user exists without a vault and its key material.
- Missing/unwrappable key material **fails closed** (`getVaultDek` raises 409/500;
  the release path cannot proceed).
- Rotation: `rotateMasterKey` re-wraps every DEK under a new key; see
  docs/backup-recovery.md.

## Authentication

- **Passwords**: Argon2id (19 MiB, 2 iterations, 1 lane). Policy: ≥10 chars,
  letter + number, common-password denylist, max 200.
- **Sessions**: random 256-bit token, returned only in an HTTP-only cookie; the
  database stores only its SHA-256. Resolution enforces expiry, revocation, user
  status (suspended/deleted blocked), and blocks seeded test accounts in
  production. Sliding expiry extends sessions idle >5 minutes.
- **MFA**: TOTP (RFC 6238, otplib) with backup codes; login issues a short-lived
  single-use challenge token when enabled. Trusted devices skip the prompt for 30 days.
- **Single-use tokens** (`email_tokens`): hashed at rest, purpose-scoped
  (verify / reset / MFA / release OTP / delivery access / recovery), expiring,
  with an attempt counter that locks a token after 5 failed consumptions.
- **Same-origin enforcement** on every mutating auth route (`assertSameOrigin`).

## Rate limiting

Durable, database-backed fixed windows (`rate_limits`), shared across web and
worker processes. Buckets are keyed by HMAC of route + IP + email — raw IPs and
emails are never stored. Auth limits: login 10/5 min, register 5/h, password
reset 5/h. Limiters for authentication paths **fail closed** if the table is
unreachable.

## Audit log

`audit_events` is append-only, enforced by a database trigger (UPDATE/DELETE
raise). `recordAudit` pseudonymizes IPs (HMAC, truncated), truncates user agents,
and drops metadata keys matching secrets/credentials/cookies/content patterns —
vault plaintext never reaches the log. The admin audit view and `/api/ready`
surface write failures loudly.

## Uploads and content safety

Uploads are size-capped (`MAX_UPLOAD_BYTES`), and production requires either a
malware-scan endpoint (`MALWARE_SCAN_URL`) or an explicit
`ALLOW_UNSCANNED_UPLOADS=true` acknowledgement to boot.

## Release safety

- Releases execute only through `executeRelease`, driven by the job queue after a
  configurable delay (`RELEASE_DELAY_SECONDS`) and verification per the owner's
  policy (email OTP, trusted-contact threshold, evidence review).
- State transitions are compare-and-swap conditional UPDATEs; stale jobs cannot
  drive an illegal transition (matrix in `src/lib/checkin/schedule.ts`).
- Delivery access uses scoped, expiring tokens (`delivery_access`), never
  permanent links.
- The queue is idempotent (unique idempotency keys), with exponential backoff,
  dead-lettering, and stale-lock reclaim.

## Production boot guards

`src/lib/env.ts` refuses to start in production when: the known development
encryption key or app-secret prefix is present, test routes are enabled, the file
email provider is selected, uploads are unscanned without acknowledgement, or S3
is configured without credentials. See docs/production-checklist.md.

## Out of scope / known limitations

- The master key is held in the server environment: a fully compromised server
  can read vault content. Mitigations: key rotation, audit trail, minimal
  privileged access, infrastructure hardening (docs/deploy.md).
- Billing (Stripe) is integrated to the point of plan/subscription records; live
  price objects are intentionally not invented before real Stripe configuration.
- No external penetration test has been performed; see REPORT.md.
