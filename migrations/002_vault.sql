-- AfterKey — 002_vault.sql
-- Vaults and every user-owned vault module: financial records, digital accounts,
-- documents, properties, legacy messages, recipients and their permissions.

CREATE TABLE IF NOT EXISTS vaults (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'My Vault',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Key separation: wrapped_dek is sealed with the server master key (KEK) so the
-- release worker can decrypt under verified conditions; wrapped_dek_recovery is
-- sealed with a key derived from the user's 24-word recovery phrase (held only
-- by the user). The vault DEK itself is never stored in plaintext.
CREATE TABLE IF NOT EXISTS vault_keys (
  vault_id             uuid PRIMARY KEY REFERENCES vaults(id) ON DELETE CASCADE,
  wrapped_dek          text NOT NULL,
  key_version          integer NOT NULL DEFAULT 1,
  wrapped_dek_recovery text,
  recovery_verifier    text,
  recovery_created_at  timestamptz,
  recovery_rotated_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS financial_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id              uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  category              text NOT NULL CHECK (category IN (
                          'bank', 'credit_card', 'savings', 'pension', 'investment',
                          'mortgage', 'loan', 'life_insurance', 'health_insurance',
                          'tax', 'business', 'subscription', 'other')),
  institution           text NOT NULL,
  nickname              text,
  account_type          text,
  masked_identifier     text,
  provider_url          text,
  provider_phone        text,
  reference_number      text,
  named_contact         text,
  opened_on             date,
  maturity_on           date,
  claim_instructions    text,   -- encrypted (enc:v1:…)
  notes                 text,   -- encrypted (enc:v1:…)
  last_reviewed_on      date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);

CREATE INDEX IF NOT EXISTS financial_records_vault_idx ON financial_records (vault_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS financial_records_search_idx ON financial_records (vault_id, lower(institution));
CREATE INDEX IF NOT EXISTS financial_records_category_idx ON financial_records (vault_id, category);

CREATE TABLE IF NOT EXISTS digital_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id             uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  category             text NOT NULL CHECK (category IN (
                         'email', 'social', 'cloud', 'domain', 'business',
                         'subscription', 'device', 'crypto', 'other')),
  service_name         text NOT NULL,
  username             text,
  website              text,
  account_email        text,
  recovery_instructions text,  -- encrypted (enc:v1:…)
  notes                text,   -- encrypted (enc:v1:…)
  last_reviewed_on     date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz
);

CREATE INDEX IF NOT EXISTS digital_accounts_vault_idx ON digital_accounts (vault_id, archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS digital_accounts_search_idx ON digital_accounts (vault_id, lower(service_name));

CREATE TABLE IF NOT EXISTS documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id       uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  title          text NOT NULL,
  category       text NOT NULL DEFAULT 'other'
                 CHECK (category IN ('financial', 'property', 'identity', 'legal', 'medical', 'memory', 'export', 'other')),
  notes          text,
  tags           text[] NOT NULL DEFAULT '{}',
  filename       text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 text NOT NULL,
  storage_key    text NOT NULL UNIQUE,
  enc_iv         text NOT NULL,
  enc_tag        text NOT NULL,
  scan_status    text NOT NULL DEFAULT 'pending'
                 CHECK (scan_status IN ('pending', 'clean', 'infected', 'skipped', 'error')),
  scan_detail    text,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,
  deleted_at     timestamptz
);

CREATE INDEX IF NOT EXISTS documents_vault_idx ON documents (vault_id, deleted_at, archived_at, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS documents_scan_idx ON documents (scan_status) WHERE scan_status IN ('pending', 'error');

CREATE TABLE IF NOT EXISTS document_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('financial', 'digital', 'property', 'memory')),
  target_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS document_links_target_idx ON document_links (target_type, target_id);

CREATE TABLE IF NOT EXISTS properties (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id               uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  property_type          text NOT NULL DEFAULT 'other'
                         CHECK (property_type IN ('primary', 'rental', 'land', 'commercial', 'holiday', 'storage', 'other')),
  address_line           text,
  city                   text,
  region                 text,
  postal_code            text,
  country                text,
  latitude               double precision CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  longitude              double precision CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  description            text,
  ownership_reference    text,
  emergency_instructions text,  -- encrypted (enc:v1:…)
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  archived_at            timestamptz
);

CREATE INDEX IF NOT EXISTS properties_vault_idx ON properties (vault_id, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS recipients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id       uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  display_name   text NOT NULL,
  email          text NOT NULL,
  relationship   text,
  status         text NOT NULL DEFAULT 'invited'
                 CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  linked_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  notification_prefs jsonb NOT NULL DEFAULT '{"email": true}'::jsonb,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  UNIQUE (vault_id, email),
  CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS recipients_vault_idx ON recipients (vault_id, status);
CREATE INDEX IF NOT EXISTS recipients_user_idx ON recipients (linked_user_id);

CREATE TABLE IF NOT EXISTS recipient_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  vault_id     uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  email        text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS recipient_invitations_recipient_idx ON recipient_invitations (recipient_id, expires_at DESC);

-- What a recipient may receive when a release executes. Recipients never
-- inherit one another's permissions; every grant is stored per recipient.
CREATE TABLE IF NOT EXISTS recipient_permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  vault_id     uuid NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('financial', 'digital', 'documents', 'properties', 'messages')),
  item_id      uuid,
  scope        text NOT NULL DEFAULT 'release_only' CHECK (scope IN ('release_only')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (recipient_id, category, item_id)
);

CREATE INDEX IF NOT EXISTS recipient_permissions_recipient_idx ON recipient_permissions (recipient_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vaults', 'vault_keys', 'financial_records', 'digital_accounts', 'documents',
    'properties', 'recipients', 'recipient_invitations', 'recipient_permissions'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I;
       CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t || '_set_updated_at', t, t || '_set_updated_at', t
    );
  END LOOP;
END $$;
