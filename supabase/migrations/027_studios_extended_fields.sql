-- Structured address fields (replacing the legacy single `location` text field)
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS street_address text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city          text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS postal_code   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country       text NOT NULL DEFAULT '';

-- Calendar configuration
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS calendar_start_hour             integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS calendar_end_hour               integer NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS appointment_duration_minutes    integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS appointment_min_advance_weeks   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS appointment_slots               jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- GHL calendar ID (used for appointment create/reschedule API calls)
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS ghl_calendar_id text;

-- Per-studio Retell API key (overrides the global env var when set)
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS retell_api_key text;

-- Soft-delete support for studios
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
