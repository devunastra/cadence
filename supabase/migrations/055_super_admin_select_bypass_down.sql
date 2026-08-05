-- Rollback for 055_super_admin_select_bypass.sql
--
-- Restores get_my_studio_ids() to membership-only, and restores the ten SELECT
-- policies to the exact inline expressions captured from pg_policy before the
-- change. After running this, super_admins again see only studios they hold a
-- studio_users row for — i.e. an appointment can exist and still be invisible
-- on /calendar, which is the behaviour 055 fixed.
--
-- Run this if the super_admin read model turns out not to be wanted.

CREATE OR REPLACE FUNCTION public.get_my_studio_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  SELECT ARRAY(
    SELECT studio_id FROM studio_users WHERE user_id = auth.uid()
  )
$function$;

COMMENT ON FUNCTION public.get_my_studio_ids() IS NULL;

DROP POLICY IF EXISTS "studio members can read activity logs" ON public.activity_logs;
CREATE POLICY "studio members can read activity logs" ON public.activity_logs
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));

DROP POLICY IF EXISTS "studio members can read appointment_events" ON public.appointment_events;
CREATE POLICY "studio members can read appointment_events" ON public.appointment_events
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));

DROP POLICY IF EXISTS "studio members can view appointments" ON public.appointments;
CREATE POLICY "studio members can view appointments" ON public.appointments
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view call reviews for their studios" ON public.call_reviews;
CREATE POLICY "Users can view call reviews for their studios" ON public.call_reviews
  FOR SELECT USING (studio_id IN (SELECT su.studio_id FROM studio_users su WHERE su.user_id = auth.uid()));

DROP POLICY IF EXISTS "studio members can select conversations" ON public.conversations;
CREATE POLICY "studio members can select conversations" ON public.conversations
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));

DROP POLICY IF EXISTS "studio members can read lead_views" ON public.lead_views;
CREATE POLICY "studio members can read lead_views" ON public.lead_views
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));

DROP POLICY IF EXISTS "studio members can select messages" ON public.messages;
CREATE POLICY "studio members can select messages" ON public.messages
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view notion sync log for their studios" ON public.notion_sync_log;
CREATE POLICY "Users can view notion sync log for their studios" ON public.notion_sync_log
  FOR SELECT USING (studio_id IN (SELECT su.studio_id FROM studio_users su WHERE su.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view scheduled calls for their studios" ON public.scheduled_calls;
CREATE POLICY "Users can view scheduled calls for their studios" ON public.scheduled_calls
  FOR SELECT USING (studio_id IN (SELECT su.studio_id FROM studio_users su WHERE su.user_id = auth.uid()));

DROP POLICY IF EXISTS "studio members can read field options" ON public.studio_field_options;
CREATE POLICY "studio members can read field options" ON public.studio_field_options
  FOR SELECT USING (studio_id IN (SELECT studio_users.studio_id FROM studio_users WHERE studio_users.user_id = auth.uid()));
