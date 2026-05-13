-- Add analytics preferences column (direction + date preset for call analytics page)
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS analytics jsonb DEFAULT '{}'::jsonb;

-- Add page_filters column (persisted filter + sort state per page per user)
-- Structure: { leads: { filters, sort }, transcripts: {...}, appointmentList: {...} }
ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS page_filters jsonb NOT NULL DEFAULT '{}'::jsonb;
