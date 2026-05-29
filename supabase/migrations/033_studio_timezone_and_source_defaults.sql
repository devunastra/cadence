-- Phase 1 of client onboarding (see docs/specs/client-onboarding-spec.md).
-- Two additive, non-destructive changes. Safe to run on the live DB:
--   1. Adds studios.timezone with a constant default (metadata-only in PG11+, no table rewrite).
--   2. Redefines seed_studio_field_options with the new source defaults.
--      CREATE OR REPLACE only changes the function body — it does NOT execute,
--      and it does NOT modify any existing studio_field_options rows.
-- No existing studio data is touched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Per-studio timezone (replaces the hardcoded 'America/Chicago' in app code, Phase 5)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. New default lead-source set for newly onboarded studios.
--    Only affects studios seeded AFTER this runs — existing studios keep their
--    current source options. Resolves the old Guests/Events vs Guest/Event
--    mismatch by replacing the source list entirely.
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
    (p_studio_id, 'level', 'Inquiry'),
    (p_studio_id, 'level', 'Front'),
    (p_studio_id, 'level', 'Middle'),
    (p_studio_id, 'level', 'Back'),
    (p_studio_id, 'level', 'Loss'),
    (p_studio_id, 'level', 'Guest'),
    (p_studio_id, 'level', 'Bronze 1'),
    (p_studio_id, 'level', 'Bronze 2'),
    (p_studio_id, 'level', 'Bronze 3'),
    (p_studio_id, 'level', 'Bronze 4'),
    (p_studio_id, 'level', 'Silver 1'),
    (p_studio_id, 'level', 'Silver 2'),
    (p_studio_id, 'level', 'Old Inquiry'),
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
