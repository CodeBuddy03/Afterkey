# Testing

## Suites

| Suite | Command | Target |
| --- | --- | --- |
| Unit | `npm test` | Pure logic, no I/O (`tests/unit`) |
| Integration | `npm run test:integration` | Real PostgreSQL `afterkey_test` |
| E2E | `npm run test:e2e` | Real browser + real server, `afterkey_e2e` |
| Everything | `npm run check` / `npx vitest run` | typecheck + lint + both Vitest projects |

## Unit tests

`tests/unit/setup.ts` loads `.env.local` so crypto helpers resolve the same
validated configuration the app uses.

Coverage: AES-GCM encryption (round trip, wrong key, AAD binding, tamper
detection), key wrapping, Argon2id hashing + password policy, TOTP (RFC 6238
vector, whitespace tolerance, backup codes, otpauth URI), validation primitives
(email/id/timezone/local time), and DST/leap-year-safe check-in scheduling
(including the reminder-interval rule and the state-transition matrix).

## Integration tests

One shared database; files run serially (`fileParallelism: false`) and each file
starts from a truncated database. `tests/integration/setup.ts`:

1. loads `.env.local`, repoints `DATABASE_URL` at **`afterkey_test`**,
   sets `NODE_ENV=test`;
2. truncates every public table except `schema_migrations` and the FK reference
   table `plans` (seeded by migration 005 — truncating it breaks registration);
3. closes the pool after the file.

Provision once: `npm run db:setup-test`.

`tests/integration/helpers.ts` builds users through the same code path as
registration (Argon2 hash, vault + wrapped DEK, release policy, check-in
schedule, subscription), so service-layer tests run against realistic rows.

Covered: session lifecycle (hash-only storage, revocation, suspension,
sliding expiry), vault ownership (404 not 403), DEK unwrap, recovery material,
single-use tokens (replay, purpose isolation, expiry, attempt lockout), job queue
(idempotency, single-claim, backoff → dead letter, payload cancel, **no negative
queue age when scheduled ahead**), durable rate limiting, and the append-only
audit log (HMAC'd IPs, sanitized metadata, blocked UPDATE/DELETE).

## E2E tests

`playwright.config.ts` boots `scripts/e2e-server.mjs`, which:

1. loads `.env.local`, points `DATABASE_URL` at **`afterkey_e2e`** and
   `APP_URL` at `http://127.0.0.1:3100`;
2. applies migrations (idempotent);
3. **resets `afterkey_e2e`** (all tables except `plans`/bookkeeping) so every
   run is deterministic — this also clears the durable auth rate-limit buckets;
4. runs a **production `next build`** (with gate-compliant throwaway secrets
   for the prerender), then `next start -p 3100` with test routes enabled.

Why production mode: `next dev` serializes on-demand compiles, so runtime
requests queue behind chunk builds (a logout POST once took 40 s mid-test and
caused flaky failures). Against a real build, every response is immediate and
the whole suite finishes in minutes with stable timings. Auth API routes are
still warmed in `beforeAll` as a belt-and-braces measure.

The development database is never touched. Specs:

- `smoke.spec.ts` — marketing pages, pricing (plans from the database), auth
  entry points, signed-out redirects.
- `auth.spec.ts` — the full lifecycle: register → fetch the *delivered*
  verification message from the test mailbox → follow the link → sign in →
  onboarding → sign out → route protection; plus wrong-password rejection.
  Auth API routes are warmed in `beforeAll` so Next's on-demand compile doesn't
  race the first submit.
- `responsive.spec.ts` — mobile project only (iPhone 13/WebKit): no horizontal
  overflow, mobile menu, usable signup.

Test-only endpoints (`/api/test/mailbox|clock|tick`) require
`AFTERKEY_ENABLE_TEST_ROUTES=true`, which production boot refuses.

## Notes

- Register allows 5/hour per IP and the limiter is database-backed; the e2e DB
  reset at server boot clears buckets. If you reuse a long-running e2e server
  across many local runs, restart it to reset limits.
- Accessibility: form controls must expose accessible names — `Field` wires
  `label[for]`/`aria-describedby` into its control (including controls nested in
  wrapper elements). New form components should keep that contract.
