-- Activity logs v2: add lead_id, changes, and source columns.
-- message column is left as-is (nullable, never populated).

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS lead_id  uuid REFERENCES leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS changes  jsonb,
  ADD COLUMN IF NOT EXISTS source   text;
