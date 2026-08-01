-- Migration 055: give super_admin the read access it is already documented to have.
--
-- CLAUDE.md and rules/authentication.md both state "super_admin bypasses RLS".
-- That was never true for reads. Of 18 SELECT policies, zero contained a
-- super_admin clause, while 1 INSERT, 1 UPDATE and 2 DELETE policies did — so the
-- model was half-implemented rather than absent.
--
-- The symptom: lib/data-cache.ts getStudios() deliberately uses the service client
-- for super_admins, so they see EVERY studio in the switcher. Selecting a studio
-- they hold no studio_users row for then renders a normal-looking empty page —
-- appointments, leads, calls and conversations all silently filtered out by RLS.
-- Found when a booked appointment was invisible on /calendar despite existing.
--
-- Approach: put the rule in get_my_studio_ids() — a STABLE SECURITY DEFINER helper
-- five policies already use — and normalise the ten inline studio-scoped SELECT
-- policies onto that same helper. Eleven copies of the expression become one.
--
-- SECURITY DEFINER matters here: the helper reads studio_users without RLS
-- applying, so the studio_users policy calling it cannot recurse.
--
-- This is additive. For every non-super_admin the helper returns exactly what it
-- returned before, so studio_owner and studio_staff access is bit-for-bit
-- unchanged. It cannot expose one studio's data to another studio's staff.
--
-- Deliberately NOT changed:
--   notifications, user_preferences      - scoped by user_id, not studio_id. These
--                                          are personal data; a super_admin has no
--                                          business reading another user's
--                                          notifications or column widths.
--   studio_integration_health            - deliberately restricted to studio_owner.
--                                          Widening it is a separate decision about
--                                          role semantics, not this bug.
--
-- Rollback: see 055_super_admin_select_bypass_down.sql

-- ── 1. the helper ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_studio_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM studio_users
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
    THEN ARRAY(SELECT id FROM studios)
    ELSE ARRAY(SELECT studio_id FROM studio_users WHERE user_id = auth.uid())
  END
$function$;

COMMENT ON FUNCTION public.get_my_studio_ids() IS
  'Studio ids the current user may read. super_admin gets every studio, matching the documented access model. SECURITY DEFINER so the studio_users SELECT policy can call it without recursing.';

-- ── 2. normalise the ten inline studio-scoped SELECT policies ───────────────
-- Each previously inlined:
--   studio_id IN (SELECT studio_id FROM studio_users WHERE user_id = auth.uid())
-- which is exactly what get_my_studio_ids() returns for a non-super_admin.

DROP POLICY IF EXISTS "studio members can read activity logs" ON public.activity_logs;
CREATE POLICY "studio members can read activity logs" ON public.activity_logs
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "studio members can read appointment_events" ON public.appointment_events;
CREATE POLICY "studio members can read appointment_events" ON public.appointment_events
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "studio members can view appointments" ON public.appointments;
CREATE POLICY "studio members can view appointments" ON public.appointments
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "Users can view call reviews for their studios" ON public.call_reviews;
CREATE POLICY "Users can view call reviews for their studios" ON public.call_reviews
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "studio members can select conversations" ON public.conversations;
CREATE POLICY "studio members can select conversations" ON public.conversations
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "studio members can read lead_views" ON public.lead_views;
CREATE POLICY "studio members can read lead_views" ON public.lead_views
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "studio members can select messages" ON public.messages;
CREATE POLICY "studio members can select messages" ON public.messages
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "Users can view notion sync log for their studios" ON public.notion_sync_log;
CREATE POLICY "Users can view notion sync log for their studios" ON public.notion_sync_log
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "Users can view scheduled calls for their studios" ON public.scheduled_calls;
CREATE POLICY "Users can view scheduled calls for their studios" ON public.scheduled_calls
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

DROP POLICY IF EXISTS "studio members can read field options" ON public.studio_field_options;
CREATE POLICY "studio members can read field options" ON public.studio_field_options
  FOR SELECT USING (studio_id = ANY (get_my_studio_ids()));

-- calls, leads, studio_test_agents, studio_users and studios already call
-- get_my_studio_ids() and so are fixed by step 1 alone.
