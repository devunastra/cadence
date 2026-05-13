-- Add Retell quality score (0–10 numeric)
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS quality_score numeric;

-- Whether the call resulted in an appointment being booked
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS appointment_booked boolean DEFAULT false;

-- Retell recording URL
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS recording_url text;
