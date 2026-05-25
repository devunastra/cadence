-- Migration 031: Voice agent kill switch
-- Adds a per-studio toggle that pauses all AI voice agent activity
-- (outbound, inbound, manual click-to-call) without affecting lead intake,
-- messaging, or calendar. Lead inquiries still flow into the dashboard.

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS voice_agent_enabled    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS voice_agent_paused_at  timestamptz,
  ADD COLUMN IF NOT EXISTS voice_agent_paused_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Stored so we can restore the Retell phone number's inbound_agent_id on resume.
  -- Populated lazily the first time the agent is paused.
  ADD COLUMN IF NOT EXISTS retell_inbound_agent_id text,
  -- Retell phone number (E.164) whose inbound_agent_id we clear on pause.
  -- Required for the inbound kill switch; if null, inbound block is skipped.
  ADD COLUMN IF NOT EXISTS retell_phone_number     text;

-- RLS: only studio_owner / super_admin can flip the switch.
-- Existing studios SELECT policy already covers reads; this adds the write guard.
DROP POLICY IF EXISTS "Owners and super admins can update voice agent state" ON studios;
CREATE POLICY "Owners and super admins can update voice agent state"
  ON studios FOR UPDATE
  USING (
    id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
        AND su.role IN ('studio_owner', 'super_admin')
    )
  )
  WITH CHECK (
    id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
        AND su.role IN ('studio_owner', 'super_admin')
    )
  );
