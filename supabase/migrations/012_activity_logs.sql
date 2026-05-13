-- Studio-wide activity log for lead table events
CREATE TABLE activity_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id  uuid        NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  message    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studio members can read activity logs"
  ON activity_logs FOR SELECT
  USING (studio_id IN (SELECT studio_id FROM studio_users WHERE user_id = auth.uid()));

CREATE POLICY "studio members can insert activity logs"
  ON activity_logs FOR INSERT
  WITH CHECK (studio_id IN (SELECT studio_id FROM studio_users WHERE user_id = auth.uid()));
