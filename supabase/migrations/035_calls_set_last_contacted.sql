-- Migration 035: a call linked to a lead automatically sets leads.last_contacted
-- last_contacted is stored as ISO-8601 text (e.g. 2026-05-29T19:31:12.109Z); the app formats it.
-- Trigger keeps it current for ALL future calls (any source: app webhook or n8n).
-- One-time backfill covers existing calls for Lincolnshire (AMLS), excluding the John Test record.

CREATE OR REPLACE FUNCTION set_lead_last_contacted_from_call()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE leads l
    SET last_contacted = to_char(NEW.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    WHERE l.id = NEW.lead_id
      AND (
        l.last_contacted IS NULL OR btrim(l.last_contacted) = ''
        OR (l.last_contacted ~ '^\d{4}-\d{2}-\d{2}T'
            AND l.last_contacted::timestamptz < NEW.created_at)
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_call_sets_last_contacted ON calls;
CREATE TRIGGER trg_call_sets_last_contacted
  AFTER INSERT OR UPDATE OF lead_id, created_at ON calls
  FOR EACH ROW EXECUTE FUNCTION set_lead_last_contacted_from_call();

-- One-time backfill from existing calls (AMLS only; excludes John Test test record)
WITH last_call AS (
  SELECT lead_id, max(created_at) AS latest FROM calls
  WHERE studio_id='71274499-7c29-4621-990f-b60669ed1de3' AND lead_id IS NOT NULL
  GROUP BY lead_id
)
UPDATE leads l
SET last_contacted = to_char(lc.latest AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM last_call lc
WHERE l.id = lc.lead_id
  AND l.studio_id='71274499-7c29-4621-990f-b60669ed1de3'
  AND l.name <> 'John Test'
  AND (l.last_contacted IS NULL OR btrim(l.last_contacted)=''
       OR (l.last_contacted ~ '^\d{4}-\d{2}-\d{2}T' AND l.last_contacted::timestamptz < lc.latest));
