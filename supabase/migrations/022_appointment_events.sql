-- Appointment events table
-- Tracks Created / Updated / Rescheduled / Deleted events for appointments.
-- Written by server actions and the GHL appointment webhook.
-- The conversations page subscribes via Supabase Realtime to update chips in real-time.

CREATE TABLE IF NOT EXISTS appointment_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id      uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  appointment_id text NOT NULL,
  contact_id     text,
  verb           text NOT NULL, -- 'Created' | 'Updated' | 'Rescheduled' | 'Deleted'
  new_start_time timestamptz,   -- populated for Rescheduled/Updated with new time
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Index for Realtime filter lookups
CREATE INDEX IF NOT EXISTS appointment_events_studio_id_idx ON appointment_events(studio_id);
CREATE INDEX IF NOT EXISTS appointment_events_appointment_id_idx ON appointment_events(appointment_id);

-- RLS
ALTER TABLE appointment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studio members can read appointment_events"
  ON appointment_events FOR SELECT
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_users WHERE user_id = auth.uid()
    )
  );

-- Service role can insert (used by server actions + webhooks)
CREATE POLICY "service role can insert appointment_events"
  ON appointment_events FOR INSERT
  WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE appointment_events;
