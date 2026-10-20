-- AfterKey — 004_ops.sql
-- Email outbox (transactional), billing, support and account data workflows.

CREATE TABLE IF NOT EXISTS email_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email           text NOT NULL,
  to_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  template           text NOT NULL,
  subject            text NOT NULL,
  html_body          text NOT NULL,
  text_body          text NOT NULL,
  status             text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'bounced', 'complained', 'canceled')),
  provider           text,
  provider_message_id text,
  error_code         text,
  error_detail       text,
  attempts           integer NOT NULL DEFAULT 0,
  max_attempts       integer NOT NULL DEFAULT 6,
  dedupe_key         text UNIQUE,
  related_type       text,
  related_id         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz
);

CREATE INDEX IF NOT EXISTS email_messages_status_idx ON email_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_to_idx ON email_messages (to_email, created_at DESC);

CREATE TABLE IF NOT EXISTS email_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('queued', 'sent', 'failed', 'bounced', 'complained', 'retry_scheduled', 'canceled')),
  detail     text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_events_message_idx ON email_events (message_id, occurred_at);

CREATE TABLE IF NOT EXISTS plans (
  slug            text PRIMARY KEY CHECK (slug IN ('free', 'personal', 'family', 'premium_legacy')),
  name            text NOT NULL,
  description     text NOT NULL,
  features        jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_cents     integer,
  currency        text,
  stripe_price_id text,
  published       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_slug             text NOT NULL REFERENCES plans(slug),
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete')),
  provider              text NOT NULL DEFAULT 'none' CHECK (provider IN ('none', 'stripe')),
  provider_customer_id  text,
  provider_subscription_id text,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Idempotent webhook processing.
CREATE TABLE IF NOT EXISTS provider_events (
  provider     text NOT NULL,
  event_id     text NOT NULL,
  type         text,
  status       text NOT NULL DEFAULT 'received'
               CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  error        text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS data_export_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'ready', 'failed')),
  document_id  uuid REFERENCES documents(id) ON DELETE SET NULL,
  error        text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS data_export_requests_user_idx ON data_export_requests (user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested', 'scheduled', 'canceled', 'completed')),
  reason       text,
  admin_note   text,
  execute_after timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_deletion_requests_status_idx ON data_deletion_requests (status, execute_after);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_messages', 'plans', 'subscriptions', 'data_deletion_requests'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I;
       CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t || '_set_updated_at', t, t || '_set_updated_at', t
    );
  END LOOP;
END $$;
