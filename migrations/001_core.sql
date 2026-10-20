-- AfterKey — 001_core.sql
-- Accounts, sessions, security primitives, audit, operational tables.

CREATE TABLE IF NOT EXISTS users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL UNIQUE,
  password_hash         text,
  full_name             text,
  role                  text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status                text NOT NULL DEFAULT 'unverified'
                        CHECK (status IN ('unverified', 'active', 'suspended', 'deletion_pending', 'deleted')),
  email_verified_at     timestamptz,
  is_seed_test_account  boolean NOT NULL DEFAULT false,
  force_password_change boolean NOT NULL DEFAULT false,
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret_enc        text,
  timezone              text NOT NULL DEFAULT 'Africa/Nairobi',
  locale                text NOT NULL DEFAULT 'en',
  notification_prefs    jsonb NOT NULL DEFAULT
                        '{"checkinReminders": true, "securityAlerts": true, "releaseAlerts": true, "productUpdates": false}'::jsonb,
  password_changed_at   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);

-- Single-use, expiring, hashed tokens (verification, reset, MFA challenge,
-- delivery access, recovery challenge). Raw tokens never touch the database.
CREATE TABLE IF NOT EXISTS email_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL
              CHECK (purpose IN ('email_verify', 'password_reset', 'mfa_reset', 'mfa_challenge', 'release_otp', 'delivery_access', 'recovery_challenge')),
  token_hash  text NOT NULL UNIQUE,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_tokens_user_purpose_idx ON email_tokens (user_id, purpose, expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  reauth_at    timestamptz,
  ip_hash      text,
  user_agent   text
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, expires_at);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash  text NOT NULL,
  device_name  text NOT NULL DEFAULT 'Unknown device',
  trusted_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  UNIQUE (user_id, device_hash)
);

-- Fixed-window rate limiting, durable across processes.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);

-- Append-only security audit log (UPDATE/DELETE blocked by trigger below).
CREATE TABLE IF NOT EXISTS audit_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type  text NOT NULL CHECK (actor_type IN ('user', 'admin', 'recipient', 'system')),
  actor_id    uuid,
  actor_label text,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  ip_hash     text,
  user_agent  text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events (target_type, target_id);

CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();

-- Small key/value operational settings (worker heartbeat, test clock offset…).
CREATE TABLE IF NOT EXISTS system_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_step    integer NOT NULL DEFAULT 0,
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text NOT NULL,
  subject     text NOT NULL,
  message     text NOT NULL,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'resolved', 'closed')),
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_requests_status_idx ON support_requests (status, created_at DESC);

-- Generic updated_at maintenance.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'onboarding_progress', 'support_requests', 'system_settings'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I;
       CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t || '_set_updated_at', t, t || '_set_updated_at', t
    );
  END LOOP;
END $$;
