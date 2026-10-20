-- AfterKey — 005_reference.sql
-- Reference data required by foreign keys, plus small additive columns.

INSERT INTO plans (slug, name, description, features, price_cents, currency, published, sort_order) VALUES
  ('free', 'Free', 'Everything one person needs to start organising the essentials.',
   '["1 vault", "Core record types", "Up to 3 recipients", "Check-in schedule", "Basic reminders"]'::jsonb,
   NULL, NULL, true, 1),
  ('personal', 'Personal', 'For one person who wants the full set of records, documents and messages.',
   '["Everything in Free", "Unlimited records", "Unlimited recipients", "Documents and media", "Property map", "Legacy messages", "Verification procedures"]'::jsonb,
   NULL, NULL, true, 2),
  ('family', 'Family', 'For households organising records and instructions together.',
   '["Everything in Personal", "Multiple family members", "Shared property records", "Family document library", "Priority support"]'::jsonb,
   NULL, NULL, true, 3),
  ('premium_legacy', 'Premium Legacy', 'For executors and more complex estates needing the deepest workflow support.',
   '["Everything in Family", "Executor-focused workflows", "Evidence review workflow", "Extended delivery history", "Priority review"]'::jsonb,
   NULL, NULL, true, 4)
ON CONFLICT (slug) DO NOTHING;

-- Prices are intentionally NULL: plan structure is published, pricing is not
-- invented. Set price_cents + stripe_price_id when billing is configured
-- (docs/integrations.md §Billing).

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes text[] NOT NULL DEFAULT '{}';
