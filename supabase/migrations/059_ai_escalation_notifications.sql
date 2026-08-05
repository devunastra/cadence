-- AI escalation notifications.
--
-- When the voice agent cannot hand a caller to a human — the live transfer
-- rings out, hits voicemail, or the caller is escalated for a question Sarah
-- can't answer — the n8n `escalate_message` branch already appends a line to
-- `leads.notes`. Nothing told the studio team about it.
--
-- This adds a single RPC the n8n branch calls once. It resolves the lead,
-- builds the notification copy, and fans out one `notifications` row per
-- recipient — mirroring the audience rule in
-- `app/api/webhooks/ghl-appointment/route.ts` (dispatchAppointmentNotifications).
--
-- Why an RPC and not four more n8n HTTP nodes: the audience rule (studio
-- members ∪ every super_admin) is a product decision, not workflow plumbing.
-- Keeping it in one place means a third studio's workflow gets the same
-- behaviour by calling the same function.
--
-- `notifications.type` is unconstrained text by design (see 047), so no
-- constraint change is needed to introduce the 'ai_escalation' kind.

CREATE OR REPLACE FUNCTION notify_ai_escalation(
  p_studio_id  uuid,
  p_first_name text DEFAULT NULL,
  p_last_name  text DEFAULT NULL,
  p_phone      text DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_message    text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_msg     text := nullif(btrim(coalesce(p_message, '')), '');
  v_name    text := nullif(btrim(concat_ws(' ',
                      nullif(btrim(coalesce(p_first_name, '')), ''),
                      nullif(btrim(coalesce(p_last_name, '')), ''))), '');
  v_local10 text;
  v_lead_id uuid;
  v_lead_nm text;
  v_who     text;
  v_body    text;
  v_link    text;
  v_count   integer;
BEGIN
  IF p_studio_id IS NULL THEN
    RAISE EXCEPTION 'notify_ai_escalation: p_studio_id is required';
  END IF;

  -- An unresolved Retell placeholder ({{ email }}) is not an address.
  IF v_email IS NOT NULL AND position('@' in v_email) = 0 THEN
    v_email := NULL;
  END IF;

  -- Match on the last 10 digits so +1XXXXXXXXXX, 1XXXXXXXXXX and XXXXXXXXXX
  -- all resolve to the same lead regardless of how the row was written.
  IF length(v_digits) >= 10 THEN
    v_local10 := right(v_digits, 10);
  END IF;

  -- Resolve the lead. Email is the stronger key, so it wins; phone is the
  -- fallback. Newest row wins on a tie, matching the n8n note branch.
  SELECT l.id, l.name
    INTO v_lead_id, v_lead_nm
    FROM leads l
   WHERE l.studio_id = p_studio_id
     AND (
           (v_email IS NOT NULL AND lower(l.email) = v_email)
        OR (v_email IS NULL AND v_local10 IS NOT NULL
            AND right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = v_local10)
         )
   ORDER BY l.created_at DESC
   LIMIT 1;

  v_who  := coalesce(nullif(btrim(coalesce(v_lead_nm, '')), ''), v_name,
                     nullif(btrim(coalesce(p_phone, '')), ''), 'Unknown caller');
  v_body := v_who || coalesce(' — ' || left(v_msg, 300), '');

  -- Deep-link to the lead when we found one; otherwise send them to the call
  -- log, which is where an unmatched caller can still be identified.
  v_link := CASE WHEN v_lead_id IS NULL THEN '/call-history'
                 ELSE '/leads/' || v_lead_id::text END;

  -- Audience: every member of the studio, plus every super_admin anywhere.
  -- Deliberately not gated on `notify_appointment_created` — that pref is
  -- scoped to appointments, and someone who muted booking noise should still
  -- hear about a caller nobody picked up. UNION de-dupes the overlap.
  WITH audience AS (
    SELECT su.user_id FROM studio_users su WHERE su.studio_id = p_studio_id
    UNION
    SELECT su.user_id FROM studio_users su WHERE su.role = 'super_admin'
  )
  INSERT INTO notifications (studio_id, user_id, type, title, body, link, metadata)
  SELECT p_studio_id,
         a.user_id,
         'ai_escalation',
         'AI escalation — needs follow-up',
         v_body,
         v_link,
         jsonb_build_object(
           'lead_id', v_lead_id,
           'phone',   nullif(btrim(coalesce(p_phone, '')), ''),
           'email',   v_email,
           'message', v_msg
         )
    FROM audience a;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) IS
  'Fans out an ai_escalation notification to studio members + super_admins. Called by the n8n escalate_message branch. Returns the number of rows inserted.';

-- SECURITY DEFINER + an unconditional INSERT means this must never be reachable
-- from a browser session. Only the service role (n8n) may call it.
REVOKE ALL ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) TO service_role;
