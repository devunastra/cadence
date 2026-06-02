-- Migration 039: Fix set_lead_last_contacted_from_call trigger to store timestamptz directly.
-- Migrations 035 and 036 both used to_char(NEW.created_at AT TIME ZONE 'UTC', '...') to format
-- the timestamp as a text ISO before storing it in the timestamptz column (Postgres parsed it back).
-- This round-trip through text is unnecessary and inconsistent with direct timestamptz assignment.
-- Replace with NEW.created_at (already timestamptz). Forward-only; existing rows unchanged.

CREATE OR REPLACE FUNCTION set_lead_last_contacted_from_call()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE leads l
    SET last_contacted = NEW.created_at
    WHERE l.id = NEW.lead_id
      AND l.last_contacted IS NULL;  -- fallback only; never overwrite a Notion-sourced value
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger binding (trg_call_sets_last_contacted) from migration 035 is unchanged.
