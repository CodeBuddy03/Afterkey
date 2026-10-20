-- AfterKey — 007_pricing.sql
-- Introductory USD pricing for validation: Free, AfterKey Plus, AfterKey Family.
-- Prices stay in the database (monthly + annual cents) so they can be adjusted
-- without a code change. premium_legacy is unpublished (kept for FK integrity).

ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents_annual integer;

UPDATE plans SET
  name = 'Free',
  description = 'Everything one person needs to start organising the essentials.',
  features = '["One personal account","Up to 10 basic records","One trusted recipient","Basic check-in reminders","Legacy planning checklist","Account security settings"]'::jsonb,
  price_cents = 0,
  price_cents_annual = 0,
  currency = 'USD',
  published = true,
  sort_order = 1
WHERE slug = 'free';

UPDATE plans SET
  name = 'AfterKey Plus',
  description = 'For one person who wants the full set of records, documents and messages.',
  features = '["Secure document and record vault","No record-count limit","Personal letters, photos and memories","Up to five trusted recipients","Check-ins and reminder schedules","Property and asset records","Granular recipient permissions","Legacy release planning","Security activity history"]'::jsonb,
  price_cents = 499,
  price_cents_annual = 3900,
  currency = 'USD',
  published = true,
  sort_order = 2
WHERE slug = 'personal';

UPDATE plans SET
  name = 'AfterKey Family',
  description = 'For households organizing records, instructions and memories together.',
  features = '["Everything in Plus","Up to five family member accounts","Larger storage allowance (fair-use limits apply)","Shared family legacy planning where authorized","Separate private areas for each member","Expanded recipient management (up to 10 recipients)","More flexible legacy message scheduling","Priority support"]'::jsonb,
  price_cents = 999,
  price_cents_annual = 7900,
  currency = 'USD',
  published = true,
  sort_order = 3
WHERE slug = 'family';

UPDATE plans SET published = false, sort_order = 99 WHERE slug = 'premium_legacy';

-- Prices are introductory test prices, not verified optimal prices (see
-- docs/pricing.md). Recipients never pay a fee to access an authorized release.
