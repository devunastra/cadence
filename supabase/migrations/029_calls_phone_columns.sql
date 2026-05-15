-- Add caller and called phone number columns to calls table
-- These are populated from Retell API's from_number / to_number fields
ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_phone text;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS called_phone text;

-- Index for callback matching: find inbound calls by caller_phone within a studio
CREATE INDEX IF NOT EXISTS idx_calls_caller_phone_studio
  ON calls (studio_id, caller_phone)
  WHERE caller_phone IS NOT NULL AND direction = 'inbound';
