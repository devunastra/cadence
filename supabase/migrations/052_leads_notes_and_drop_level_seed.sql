-- Leads: add free-text "Notes" column, stop seeding the "Level" field for new studios.
-- Two additive, non-destructive changes. Safe to run on the live DB:
--   1. Adds leads.notes (free text) — metadata-only in PG11+, no table rewrite.
--   2. Redefines seed_studio_field_options WITHOUT the 'level' inserts.
--      CREATE OR REPLACE only changes the function body — it does NOT execute,
--      and it does NOT modify any existing studio_field_options rows.
-- The leads.level column and every existing 'level' option row are left intact,
-- so historical data survives and the change is reversible. Level is simply no
-- longer surfaced in the app UI (removed in the same change set).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Free-text Notes column on leads (teachers log call/contact notes here).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS notes text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Newly onboarded studios no longer get default 'level' options.
--    Only affects studios seeded AFTER this runs — existing studios keep their
--    current options (including any 'level' rows) untouched.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION seed_studio_field_options(p_studio_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO studio_field_options (studio_id, field, value) VALUES
    (p_studio_id, 'status', 'Active'),
    (p_studio_id, 'status', 'Out of Town'),
    (p_studio_id, 'status', 'Didn''t Buy'),
    (p_studio_id, 'status', 'Didn''t Show'),
    (p_studio_id, 'status', 'Broken Toe'),
    (p_studio_id, 'status', 'Injury'),
    (p_studio_id, 'status', 'Inactive'),
    (p_studio_id, 'status', 'On Automation'),
    (p_studio_id, 'status', 'Solicitation'),
    (p_studio_id, 'action', 'NO SHOW'),
    (p_studio_id, 'action', 'Call Back'),
    (p_studio_id, 'action', 'Scheduled'),
    (p_studio_id, 'action', 'WRONG LOCATION'),
    (p_studio_id, 'action', 'DO NOT CALL'),
    (p_studio_id, 'action', 'Emailed'),
    (p_studio_id, 'action', 'Left Message'),
    (p_studio_id, 'action', 'NO VOICEMAIL'),
    (p_studio_id, 'action', 'Other'),
    (p_studio_id, 'action', 'Revisit'),
    (p_studio_id, 'action', 'Texting'),
    (p_studio_id, 'action', 'WRONG NUMBER'),
    (p_studio_id, 'action', 'Walk-In'),
    (p_studio_id, 'action', 'Phone Call'),
    (p_studio_id, 'action', 'Bought Gift Certificate'),
    (p_studio_id, 'source', 'Website Form'),
    (p_studio_id, 'source', 'Facebook'),
    (p_studio_id, 'source', 'Email'),
    (p_studio_id, 'source', 'Walk-In'),
    (p_studio_id, 'reason', 'Wedding'),
    (p_studio_id, 'reason', 'For Fun'),
    (p_studio_id, 'reason', 'Special Occasion'),
    (p_studio_id, 'reason', 'Other'),
    (p_studio_id, 'partnership', 'Couple'),
    (p_studio_id, 'partnership', 'Single')
  ON CONFLICT (studio_id, field, value) DO NOTHING;
END $$;
