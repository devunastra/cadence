-- Normalize enum fields in leads table to reference studio_field_options.
-- After this migration, leads.status/level/action/source/reason/partnership
-- store a UUID referencing studio_field_options.id instead of raw text.
-- Rename = update 1 row in studio_field_options (no lead rows touched).

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Seed default option values into studio_field_options for every
--         existing studio so the FK population in step 4 has rows to match.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_studio_id uuid;
BEGIN
  FOR v_studio_id IN SELECT id FROM studios LOOP
    INSERT INTO studio_field_options (studio_id, field, value) VALUES
      (v_studio_id, 'status', 'Active'),
      (v_studio_id, 'status', 'Out of Town'),
      (v_studio_id, 'status', 'Didn''t Buy'),
      (v_studio_id, 'status', 'Didn''t Show'),
      (v_studio_id, 'status', 'Broken Toe'),
      (v_studio_id, 'status', 'Injury'),
      (v_studio_id, 'status', 'Inactive'),
      (v_studio_id, 'status', 'On Automation'),
      (v_studio_id, 'status', 'Solicitation'),
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
      (v_studio_id, 'source', 'Facebook Ads'),
      (v_studio_id, 'source', 'Online'),
      (v_studio_id, 'source', 'Guests'),
      (v_studio_id, 'source', 'Phone'),
      (v_studio_id, 'source', 'Walk-In'),
      (v_studio_id, 'source', 'Events'),
      (v_studio_id, 'reason', 'Wedding'),
      (v_studio_id, 'reason', 'For Fun'),
      (v_studio_id, 'reason', 'Special Occasion'),
      (v_studio_id, 'reason', 'Other'),
      (v_studio_id, 'partnership', 'Couple'),
      (v_studio_id, 'partnership', 'Single')
    ON CONFLICT (studio_id, field, value) DO NOTHING;
  END LOOP;
END $$;

-- Also seed any custom values already in leads that aren't in the defaults
INSERT INTO studio_field_options (studio_id, field, value)
  SELECT DISTINCT studio_id, 'status',      status      FROM leads WHERE status      IS NOT NULL
  ON CONFLICT (studio_id, field, value) DO NOTHING;
INSERT INTO studio_field_options (studio_id, field, value)
  SELECT DISTINCT studio_id, 'level',       level       FROM leads WHERE level       IS NOT NULL
  ON CONFLICT (studio_id, field, value) DO NOTHING;
INSERT INTO studio_field_options (studio_id, field, value)
  SELECT DISTINCT studio_id, 'action',      action      FROM leads WHERE action      IS NOT NULL
  ON CONFLICT (studio_id, field, value) DO NOTHING;
INSERT INTO studio_field_options (studio_id, field, value)
  SELECT DISTINCT studio_id, 'source',      source      FROM leads WHERE source      IS NOT NULL
  ON CONFLICT (studio_id, field, value) DO NOTHING;
INSERT INTO studio_field_options (studio_id, field, value)
  SELECT DISTINCT studio_id, 'reason',      reason      FROM leads WHERE reason      IS NOT NULL
  ON CONFLICT (studio_id, field, value) DO NOTHING;
INSERT INTO studio_field_options (studio_id, field, value)
  SELECT DISTINCT studio_id, 'partnership', partnership FROM leads WHERE partnership IS NOT NULL
  ON CONFLICT (studio_id, field, value) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Add temporary UUID columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN status_new      uuid,
  ADD COLUMN level_new       uuid,
  ADD COLUMN action_new      uuid,
  ADD COLUMN source_new      uuid,
  ADD COLUMN reason_new      uuid,
  ADD COLUMN partnership_new uuid;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Populate UUID columns from studio_field_options
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE leads l SET status_new = (
  SELECT id FROM studio_field_options
  WHERE studio_id = l.studio_id AND field = 'status' AND value = l.status
) WHERE l.status IS NOT NULL;

UPDATE leads l SET level_new = (
  SELECT id FROM studio_field_options
  WHERE studio_id = l.studio_id AND field = 'level' AND value = l.level
) WHERE l.level IS NOT NULL;

UPDATE leads l SET action_new = (
  SELECT id FROM studio_field_options
  WHERE studio_id = l.studio_id AND field = 'action' AND value = l.action
) WHERE l.action IS NOT NULL;

UPDATE leads l SET source_new = (
  SELECT id FROM studio_field_options
  WHERE studio_id = l.studio_id AND field = 'source' AND value = l.source
) WHERE l.source IS NOT NULL;

UPDATE leads l SET reason_new = (
  SELECT id FROM studio_field_options
  WHERE studio_id = l.studio_id AND field = 'reason' AND value = l.reason
) WHERE l.reason IS NOT NULL;

UPDATE leads l SET partnership_new = (
  SELECT id FROM studio_field_options
  WHERE studio_id = l.studio_id AND field = 'partnership' AND value = l.partnership
) WHERE l.partnership IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: Drop old text columns, rename UUID columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads
  DROP COLUMN status,
  DROP COLUMN level,
  DROP COLUMN action,
  DROP COLUMN source,
  DROP COLUMN reason,
  DROP COLUMN partnership;

ALTER TABLE leads RENAME COLUMN status_new      TO status;
ALTER TABLE leads RENAME COLUMN level_new       TO level;
ALTER TABLE leads RENAME COLUMN action_new      TO action;
ALTER TABLE leads RENAME COLUMN source_new      TO source;
ALTER TABLE leads RENAME COLUMN reason_new      TO reason;
ALTER TABLE leads RENAME COLUMN partnership_new TO partnership;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: Add named FK constraints (ON DELETE SET NULL so deleting an option
--         clears the field on affected leads rather than erroring)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD CONSTRAINT leads_status_fkey      FOREIGN KEY (status)      REFERENCES studio_field_options(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_level_fkey       FOREIGN KEY (level)       REFERENCES studio_field_options(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_action_fkey      FOREIGN KEY (action)      REFERENCES studio_field_options(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_source_fkey      FOREIGN KEY (source)      REFERENCES studio_field_options(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_reason_fkey      FOREIGN KEY (reason)      REFERENCES studio_field_options(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_partnership_fkey FOREIGN KEY (partnership) REFERENCES studio_field_options(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: Helper function to seed defaults for newly created studios
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
    (p_studio_id, 'source', 'Facebook Ads'),
    (p_studio_id, 'source', 'Online'),
    (p_studio_id, 'source', 'Guests'),
    (p_studio_id, 'source', 'Phone'),
    (p_studio_id, 'source', 'Walk-In'),
    (p_studio_id, 'source', 'Events'),
    (p_studio_id, 'reason', 'Wedding'),
    (p_studio_id, 'reason', 'For Fun'),
    (p_studio_id, 'reason', 'Special Occasion'),
    (p_studio_id, 'reason', 'Other'),
    (p_studio_id, 'partnership', 'Couple'),
    (p_studio_id, 'partnership', 'Single')
  ON CONFLICT (studio_id, field, value) DO NOTHING;
END $$;
