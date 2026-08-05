-- Carry the studio name on ai_escalation notifications.
--
-- Super admins receive a row for every studio, including ones they are not a
-- member of. The bell's toast previously showed only the title, so a super
-- admin working in White Rock would see "AI escalation — needs follow-up" with
-- no way to tell it was Schaumburg's caller.
--
-- The RPC already knows the studio, so the name travels with the row rather
-- than the client having to resolve it. Only `metadata` changes; title, body
-- and link are untouched.

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
  v_studio  text;
  v_who     text;
  v_body    text;
  v_link    text;
  v_count   integer;
BEGIN
  IF p_studio_id IS NULL THEN
    RAISE EXCEPTION 'notify_ai_escalation: p_studio_id is required';
  END IF;

  IF v_email IS NOT NULL AND position('@' in v_email) = 0 THEN
    v_email := NULL;
  END IF;

  IF length(v_digits) >= 10 THEN
    v_local10 := right(v_digits, 10);
  END IF;

  SELECT s.name INTO v_studio FROM studios s WHERE s.id = p_studio_id;

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

  v_link := CASE WHEN v_lead_id IS NULL THEN '/call-history'
                 ELSE '/leads/' || v_lead_id::text END;

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
           'lead_id',     v_lead_id,
           'studio_name', v_studio,
           'phone',       nullif(btrim(coalesce(p_phone, '')), ''),
           'email',       v_email,
           'message',     v_msg
         )
    FROM audience a;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION notify_ai_escalation(uuid, text, text, text, text, text) TO service_role;
