-- 017_studio_slot_config.sql
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS appointment_duration_minutes  integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS appointment_min_advance_weeks integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS appointment_slots             jsonb   NOT NULL DEFAULT '{}'::jsonb;
