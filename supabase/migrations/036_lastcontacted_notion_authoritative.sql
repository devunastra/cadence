-- Migration 036: Last Contacted is Notion-authoritative; calls are a FALLBACK only.
-- Changes the call trigger from "advance if the call is newer" to "fill only when empty",
-- so a future call never overwrites a value that came from Notion (client maintains Notion).
-- Leads with no Notion Last Contacted still get filled from their first call.

CREATE OR REPLACE FUNCTION set_lead_last_contacted_from_call()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE leads l
    SET last_contacted = to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    WHERE l.id = NEW.lead_id
      AND (l.last_contacted IS NULL OR btrim(l.last_contacted) = '');  -- fallback only; never overwrite a Notion value
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger binding (trg_call_sets_last_contacted) from migration 035 is unchanged.
