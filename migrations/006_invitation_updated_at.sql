-- Fix: 002 attached the generic set_updated_at trigger to recipient_invitations,
-- but the table was created without the column, so ANY update to an invitation
-- (acceptance, revocation) failed with `record "new" has no field "updated_at"`.
ALTER TABLE recipient_invitations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
