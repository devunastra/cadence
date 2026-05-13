-- ─────────────────────────────────────────────────────────────────────────────
-- 007_reset_and_reseed.sql
-- Clears leads + studio_field_options and re-seeds defaults for every studio.
-- Studios, studio_users, lead_views, and user_preferences are NOT touched.
-- Run this in the Supabase SQL Editor whenever you need a clean slate.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Clear leads first (FK child), then studio_field_options (FK parent)
DELETE FROM leads;
DELETE FROM studio_field_options;

-- 2. Re-seed field options for every studio that exists
DO $$
DECLARE
  v_studio_id uuid;
BEGIN
  FOR v_studio_id IN SELECT id FROM studios LOOP
    INSERT INTO studio_field_options (studio_id, field, value) VALUES
      -- Status
      (v_studio_id, 'status', 'Active'),
      (v_studio_id, 'status', 'Out of Town'),
      (v_studio_id, 'status', 'Didn''t Buy'),
      (v_studio_id, 'status', 'Didn''t Show'),
      (v_studio_id, 'status', 'Broken Toe'),
      (v_studio_id, 'status', 'Injury'),
      (v_studio_id, 'status', 'Inactive'),
      (v_studio_id, 'status', 'On Automation'),
      (v_studio_id, 'status', 'Solicitation'),
      -- Level
      (v_studio_id, 'level', 'Inquiry'),
      (v_studio_id, 'level', 'Front'),
      (v_studio_id, 'level', 'Middle'),
      (v_studio_id, 'level', 'Back'),
      (v_studio_id, 'level', 'Loss'),
      (v_studio_id, 'level', 'Guest'),
      (v_studio_id, 'level', 'Bronze 1'),
      (v_studio_id, 'level', 'Bronze 2'),
      (v_studio_id, 'level', 'Bronze 3'),
      (v_studio_id, 'level', 'Bronze 4'),
      (v_studio_id, 'level', 'Silver 1'),
      (v_studio_id, 'level', 'Silver 2'),
      (v_studio_id, 'level', 'Old Inquiry'),
      -- Action
      (v_studio_id, 'action', 'NO SHOW'),
      (v_studio_id, 'action', 'Call Back'),
      (v_studio_id, 'action', 'Scheduled'),
      (v_studio_id, 'action', 'WRONG LOCATION'),
      (v_studio_id, 'action', 'DO NOT CALL'),
      (v_studio_id, 'action', 'Emailed'),
      (v_studio_id, 'action', 'Left Message'),
      (v_studio_id, 'action', 'NO VOICEMAIL'),
      (v_studio_id, 'action', 'Other'),
      (v_studio_id, 'action', 'Revisit'),
      (v_studio_id, 'action', 'Texting'),
      (v_studio_id, 'action', 'WRONG NUMBER'),
      (v_studio_id, 'action', 'Walk-In'),
      (v_studio_id, 'action', 'Phone Call'),
      (v_studio_id, 'action', 'Bought Gift Certificate'),
      -- Source
      (v_studio_id, 'source', 'Facebook Ads'),
      (v_studio_id, 'source', 'Online'),
      (v_studio_id, 'source', 'Guests'),
      (v_studio_id, 'source', 'Phone'),
      (v_studio_id, 'source', 'Walk-In'),
      (v_studio_id, 'source', 'Events'),
      -- Reason
      (v_studio_id, 'reason', 'Wedding'),
      (v_studio_id, 'reason', 'For Fun'),
      (v_studio_id, 'reason', 'Special Occasion'),
      (v_studio_id, 'reason', 'Other'),
      -- Partnership
      (v_studio_id, 'partnership', 'Couple'),
      (v_studio_id, 'partnership', 'Single')
    ON CONFLICT (studio_id, field, value) DO NOTHING;
  END LOOP;
END $$;
