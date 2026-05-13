-- Add calendar display hour settings to studios
-- Hours are stored as integers (0–23, 24h format)
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS calendar_start_hour integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS calendar_end_hour   integer NOT NULL DEFAULT 22;

-- Set AMLS studio to 11 AM – 9 PM
UPDATE studios
SET calendar_start_hour = 11,
    calendar_end_hour   = 21
WHERE name = 'Arthur Murray Lincolnshire';
