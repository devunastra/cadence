-- Add structured columns to activity_logs for table display
ALTER TABLE activity_logs
  ADD COLUMN lead_name   text,
  ADD COLUMN actor_email text,
  ADD COLUMN event_type  text; -- 'create' | 'update' | 'delete'

-- Allow studio owners and super admins to delete log entries
CREATE POLICY "studio owners can delete activity logs"
  ON activity_logs FOR DELETE
  USING (
    studio_id IN (
      SELECT studio_id FROM studio_users
      WHERE user_id = auth.uid()
        AND role IN ('studio_owner', 'super_admin')
    )
  );
