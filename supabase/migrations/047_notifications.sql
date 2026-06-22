-- In-app notification inbox (bell + popover in the top header).
--
-- One row per recipient — if a studio has three opted-in users when an event
-- fires, the trigger writes three rows. Read state is per-user automatically.
-- Designed so a single `type` column accommodates future notification kinds
-- (lead assigned, missed call, callback requested, etc.) without schema churn.

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id   uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  metadata    jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_user_recent_idx
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_delete_own"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());

-- No INSERT policy — inserts come from server-side writes (service role) only.

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Per-user opt-in toggles, matching the existing notify_lead_* pattern.
ALTER TABLE user_preferences
  ADD COLUMN notify_appointment_created boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_appointment_toast   boolean NOT NULL DEFAULT true;

-- Idempotency guard for the GHL appointment webhook: GHL retries the same
-- AppointmentCreate payload on delivery failures, and our own createAppointment
-- server action also causes GHL to fire the webhook back. Setting this on the
-- first notification dispatch means subsequent fires of the same row are no-ops.
ALTER TABLE appointments
  ADD COLUMN notified_at timestamptz;
