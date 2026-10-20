# Pricing and plans

Introductory pricing for validation, presented in USD with a structure that
supports localized currencies later (`plans.currency`).

## Plans

| Plan | Monthly | Annual | Annual per month | Core limits |
| --- | --- | --- | --- | --- |
| Free | $0 | $0 | — | 10 records, 1 trusted recipient |
| AfterKey Plus | $4.99 | $39 | ≈ $3.25/mo, billed annually | No record-count cap, 5 recipients |
| AfterKey Family | $9.99 | $79 | ≈ $6.58/mo, billed annually | Everything in Plus, 5 family member accounts, 10 recipients |

- `premium_legacy` remains in the table (foreign-key integrity) but is
  **unpublished** and never shown.
- These are **test prices, not verified optimal prices.**

## Prices are data, not code

Migration `007_pricing.sql` writes monthly and annual cents into the `plans`
table. Adjusting a price is an UPDATE, not a deploy. UI reads published plans
through `src/lib/billing/plans.ts` (`getPublishedPlans` → `toPlanView`), which
the landing page and `/pricing` share via `PricingTable`.

## Entitlements are enforced server-side

`src/lib/billing/entitlements.ts` maps plan slug → limits and is enforced in
the record-creating routes (financial, digital, documents, messages,
properties) and the recipients route. At the cap, the API returns
`403 plan_limit_reached` with an upgrade hint. Covered by
`tests/integration/billing.test.ts`.

Rules honored in the UI:

- Every price shows its billing frequency; annual totals and the derived
  annual savings are displayed (computed from the actual numbers — no invented
  discounts).
- Annual is billed once, upfront; stated next to the price.
- No countdown timers, no preselected paid plans, no lifetime-access promises,
  no unlimited-storage claims (Family states fair-use limits).
- Recipients never pay a fee to access an authorized release.
- Family member accounts are described distinctly from trusted recipients.

## Subscriptions (not yet activated)

Paid entitlements activate only after a **verified server-side payment**. No
provider account exists yet, so:

- The Free plan is fully functional today.
- `/pricing` states plainly that paid subscriptions activate when online
  billing launches; CTAs start free.
- Administrators can provision paid plans for early customers by updating the
  user's `subscriptions` row (audited operations path).

Before enabling billing: verify the chosen provider supports the business's
country of registration, settlement, USD (and later localized) currencies,
subscriptions, refunds and applicable compliance; then implement checkout,
verified webhooks (provider identifiers only, idempotent via `provider_events`),
and upgrade/downgrade/cancel flows behind the billing abstraction. Never treat
a browser redirect as proof of payment; never activate entitlements before
server-side verification.

## Before launch, calculate real costs

Infrastructure, storage, bandwidth, email volume, payment processing, support
and tax — per plan, at expected usage — before treating these prices as final.
