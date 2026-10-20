-- AfterKey — 003_checkin_release.sql
-- Legacy messages, check-in scheduling, release policies, the release state
-- machine and the durable background job queue.

CREATE TABLE IF NOT EXISTS memories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id       uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  title          text NOT NULL,
  body           text,                 -- encrypted (enc:v1:…)
  recipient_id   uuid REFERENCES recipients(id) ON DELETE SET NULL,
  intended_label text,
  relationship   text,
  release_policy text NOT NULL DEFAULT 'manual'
                 CHECK (release_policy IN ('manual', 'on_release')),
  scheduled_for  timestamptz,
  consent_at     timestamptz,
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'ready', 'scheduled', 'released', 'archived')),
  delivery_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz
);

CREATE INDEX IF NOT EXISTS memories_vault_idx ON memories (vault_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS memories_recipient_idx ON memories (recipient_id);

CREATE TABLE IF NOT EXISTS memory_documents (
  memory_id   uuid NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, document_id)
);

-- The user's release policy, versioned; re-evaluated fresh immediately before
-- any disclosure.
CREATE TABLE IF NOT EXISTS release_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id                 uuid NOT NULL UNIQUE REFERENCES vaults(id) ON DELETE CASCADE,
  enabled                  boolean NOT NULL DEFAULT false,
  verification_method      text NOT NULL DEFAULT 'trusted_contacts'
                           CHECK (verification_method IN ('email_otp', 'trusted_contacts', 'evidence_review')),
  trusted_contact_threshold integer NOT NULL DEFAULT 1 CHECK (trusted_contact_threshold >= 1),
  delay_seconds            integer NOT NULL DEFAULT 7200 CHECK (delay_seconds >= 0),
  categories               text[] NOT NULL DEFAULT
                           '{financial, digital, documents, properties, messages}',
  overdue_notice_hours     integer NOT NULL DEFAULT 1 CHECK (overdue_notice_hours >= 0),
  version                  integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkin_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id       uuid NOT NULL UNIQUE REFERENCES vaults(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_id      uuid REFERENCES release_policies(id) ON DELETE SET NULL,
  frequency      text NOT NULL DEFAULT 'monthly'
                 CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  local_time     text NOT NULL DEFAULT '09:00' CHECK (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone       text NOT NULL DEFAULT 'Africa/Nairobi',
  anchor_date    date NOT NULL DEFAULT CURRENT_DATE,
  grace_hours    integer NOT NULL DEFAULT 72 CHECK (grace_hours >= 0),
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'paused', 'vacation', 'disabled')),
  paused_until   date,
  current_state  text NOT NULL DEFAULT 'active'
                 CHECK (current_state IN ('active', 'reminder_sent', 'overdue', 'grace_period',
                                          'verification_pending', 'release_scheduled', 'released', 'incident')),
  next_due_at    timestamptz NOT NULL,
  last_checkin_at timestamptz,
  reminders      jsonb NOT NULL DEFAULT '["d4", "d1", "due"]'::jsonb,
  active_case_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkin_schedules_due_idx ON checkin_schedules (status, next_due_at);
CREATE INDEX IF NOT EXISTS checkin_schedules_user_idx ON checkin_schedules (user_id);

CREATE TABLE IF NOT EXISTS checkin_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id     uuid NOT NULL REFERENCES checkin_schedules(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN (
                    'checkin_confirmed', 'reminder_sent', 'overdue_marked', 'grace_started',
                    'case_opened', 'verification_satisfied', 'verification_rejected',
                    'case_canceled', 'case_held', 'case_resumed', 'release_scheduled',
                    'release_executed', 'release_blocked', 'paused', 'resumed',
                    'policy_changed', 'state_changed', 'schedule_created', 'rescheduled')),
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type      text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id        uuid,
  idempotency_key text UNIQUE,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkin_events_schedule_idx ON checkin_events (schedule_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS release_cases (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id               uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  schedule_id            uuid NOT NULL REFERENCES checkin_schedules(id) ON DELETE CASCADE,
  policy_id              uuid NOT NULL REFERENCES release_policies(id) ON DELETE RESTRICT,
  state                  text NOT NULL
                         CHECK (state IN ('verification_pending', 'release_scheduled',
                                          'released', 'canceled', 'held', 'failed')),
  opened_at              timestamptz NOT NULL DEFAULT now(),
  verification_deadline_at timestamptz,
  release_at             timestamptz,
  canceled_at            timestamptz,
  canceled_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  canceled_reason        text,
  held_reason            text,
  released_at            timestamptz,
  failure_reason         text,
  policy_snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- At most one open (non-terminal) release case per schedule.
CREATE UNIQUE INDEX IF NOT EXISTS release_cases_open_unique
  ON release_cases (schedule_id)
  WHERE state IN ('verification_pending', 'release_scheduled', 'held');

CREATE INDEX IF NOT EXISTS release_cases_state_idx ON release_cases (state, release_at);
CREATE INDEX IF NOT EXISTS release_cases_vault_idx ON release_cases (vault_id, opened_at DESC);

ALTER TABLE checkin_schedules
  ADD CONSTRAINT checkin_schedules_active_case_fk
  FOREIGN KEY (active_case_id) REFERENCES release_cases(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS verification_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             uuid NOT NULL REFERENCES release_cases(id) ON DELETE CASCADE,
  method              text NOT NULL CHECK (method IN ('email_otp', 'trusted_contacts', 'evidence_review')),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'satisfied', 'rejected')),
  contact_recipient_id uuid REFERENCES recipients(id) ON DELETE SET NULL,
  token_hash          text UNIQUE,
  attestations        jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  reviewer_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_records_case_idx ON verification_records (case_id);

CREATE TABLE IF NOT EXISTS release_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     uuid NOT NULL REFERENCES release_cases(id) ON DELETE CASCADE,
  event       text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS release_events_case_idx ON release_events (case_id, occurred_at);

-- One package per recipient per case: exactly the items their permissions allow.
CREATE TABLE IF NOT EXISTS release_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES release_cases(id) ON DELETE CASCADE,
  vault_id     uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  package      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'available', 'viewed', 'failed')),
  available_at timestamptz,
  viewed_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS release_deliveries_recipient_idx ON release_deliveries (recipient_id, status);

-- Durable job queue: SKIP LOCKED polling, idempotency keys, retries, dead letter.
CREATE TABLE IF NOT EXISTS jobs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at          timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed', 'canceled', 'dead')),
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  idempotency_key text UNIQUE,
  locked_by       text,
  locked_at       timestamptz,
  last_error      text,
  canceled_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs (status, run_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS jobs_running_idx ON jobs (locked_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS jobs_type_idx ON jobs (type, status);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memories', 'release_policies', 'checkin_schedules', 'release_cases',
    'verification_records', 'release_deliveries', 'jobs'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I;
       CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t || '_set_updated_at', t, t || '_set_updated_at', t
    );
  END LOOP;
END $$;
