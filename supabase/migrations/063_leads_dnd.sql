-- Migration 063: leads.dnd — a per-lead Do Not Disturb switch for AI outbound calls.
--
-- THE RULE
--
--   "we need a DND (do not disturb) button per client. Like if we don't want a
--    specific lead to be called by the AI anymore, we should be able to stop it"
--
-- This is the lead-scoped sibling of the studio-scoped follow-ups switch (062).
-- Where 062 pauses the no-answer ladder for a WHOLE studio, this stops ALL AI
-- outbound calling for ONE lead: the follow-up ladder, manual scheduled calls,
-- and the agent's own callback tool. Inbound answering is unaffected — a lead
-- who calls in is still answered by Retell at the phone-number level.
--
-- WHY A DEDICATED BOOLEAN AND NOT THE 'DO NOT CALL' ACTION
--
-- leads.action already has a 'DO NOT CALL' value, and schedule_followup_call
-- already blocks on it (061). But that is a data-classification field the studio
-- sets to describe a lead, and it only gates the follow-up ladder — not manual
-- schedules, not the inquiry path. DND is an operational kill switch: one click,
-- explicit, independent of how the lead is classified. Keeping the two separate
-- means flipping DND never rewrites the studio's own categorisation of the lead,
-- and 'DO NOT CALL' keeps meaning exactly what it meant.
--
-- WHAT "ON" MEANS: HOLD, NOT CANCEL (same contract as 062)
--
-- Switching DND on does two things:
--
--   1. No NEW calls are queued.        <- this file (the RPC guard) + the app's
--                                         scheduleCall action (manual path).
--   2. Calls ALREADY queued are held.  <- the dialer's `Call Window Gate`, which
--                                         must skip a row whose lead has dnd=true
--                                         and leave it PENDING (called_at /
--                                         cancelled_at / skipped_at all NULL), so
--                                         switching DND back off resumes it at its
--                                         original callback_time.
--
-- Held, not cancelled: a mis-click costs nothing. This mirrors the out-of-hours
-- and follow-ups-off holds already implemented in the gate — same mechanism
-- pointed at a per-lead column instead of a studio one. See the header of 062 and
-- docs/specs/automatic-followup-calls.md for the hold-and-resume reasoning.

-- ── Columns ──────────────────────────────────────────────────────────────────
--
-- Mirrors the followups_* / voice_agent_* audit trio so the switch is read and
-- audited the same way. NOT NULL DEFAULT false: every existing lead keeps being
-- callable, and a lead row that predates this migration can never read as "on"
-- (blocked) by accident.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS dnd        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dnd_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS dnd_set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.leads.dnd IS
  'Per-lead Do Not Disturb for AI outbound calls. true = queue no new calls (follow-up ladder, manual, or agent callback) AND hold the ones already queued. Does not affect inbound answering. Independent of the ''DO NOT CALL'' action value — this is an operational kill switch, that is a data classification.';
COMMENT ON COLUMN public.leads.dnd_set_at IS
  'When dnd was last set true. Cleared on switch-off.';
COMMENT ON COLUMN public.leads.dnd_set_by IS
  'Who set dnd true. Cleared on switch-off.';

-- ── The guard ────────────────────────────────────────────────────────────────
--
-- Re-issues schedule_followup_call from 062 with ONE new early return: a lead
-- with dnd=true queues no ladder rung. Placed right after the lead is fetched and
-- before the phone/action/status tests — DND overrides all of them. Everything
-- else in this function is byte-identical to the 062 version.

CREATE OR REPLACE FUNCTION public.schedule_followup_call(
  p_studio_id      uuid,
  p_lead_id        uuid,
  p_retell_call_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead      public.leads%ROWTYPE;
  v_tz        text;
  v_on        boolean;
  v_action    text;
  v_status    text;
  v_attempt   smallint;
  v_days      integer;
  v_time      time;
  v_target    timestamptz;
  v_name      text;
  v_first     text;
  v_last      text;
  v_reason    text;
  v_new_id    uuid;
BEGIN
  IF p_studio_id IS NULL OR p_lead_id IS NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'missing_arguments');
  END IF;

  -- The studio row, read once. `followups_enabled` gates this whole function;
  -- `timezone` is needed further down for the interval arithmetic.
  SELECT coalesce(followups_enabled, true),
         coalesce(nullif(btrim(timezone), ''), 'America/Chicago')
    INTO v_on, v_tz
    FROM public.studios
   WHERE id = p_studio_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'studio_not_found');
  END IF;

  -- The studio-level switch. Deliberately the first thing tested after the
  -- arguments: when a studio has follow-ups off, an unanswered call should cost
  -- one indexed lookup and nothing else.
  --
  -- Rungs already queued are NOT touched here. They are held by the dialer and
  -- resume on switch-on — see the header. Stamping them skipped_at would make the
  -- switch destructive, which is the behaviour this was chosen over.
  IF NOT v_on THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'followups_disabled');
  END IF;

  -- Cheapest check next, and the one a webhook retry actually hits.
  IF p_retell_call_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.scheduled_calls
     WHERE followup_triggered_by_call_id = p_retell_call_id
  ) THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'already_queued_for_call');
  END IF;

  SELECT * INTO v_lead
    FROM public.leads
   WHERE id = p_lead_id AND studio_id = p_studio_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'lead_not_found');
  END IF;

  -- Per-lead Do Not Disturb (migration 063). Overrides everything below — a lead
  -- flagged DND is not called by the AI at all, regardless of phone, action, or
  -- status. Rows already queued for this lead are held by the dialer, not
  -- cancelled here, for the same reason the studio switch holds rather than wipes.
  IF v_lead.dnd THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'do_not_disturb');
  END IF;

  -- No number, no call. Cheaper to stop here than to queue a row the dialer
  -- will fail on every sweep.
  IF nullif(btrim(coalesce(v_lead.phone, '')), '') IS NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'no_phone');
  END IF;

  -- status / action / reason are uuid FKs into studio_field_options, NOT text.
  -- Resolving them to their label is the only way to test them.
  SELECT o.value INTO v_action
    FROM public.studio_field_options o WHERE o.id = v_lead.action;
  SELECT o.value INTO v_status
    FROM public.studio_field_options o WHERE o.id = v_lead.status;
  SELECT o.value INTO v_reason
    FROM public.studio_field_options o WHERE o.id = v_lead.reason;

  IF v_action IN ('DO NOT CALL', 'WRONG NUMBER', 'WRONG LOCATION') THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'do_not_contact');
  END IF;

  IF v_action = 'Scheduled'
     OR nullif(btrim(coalesce(v_lead.first_lesson, '')), '') IS NOT NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'already_booked');
  END IF;

  IF v_status IN ('Inactive', 'solicitation', 'Wrong Location') THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'lead_closed');
  END IF;

  -- Migration 053 deliberately allows duplicate pending rows (a constraint there
  -- would make Sarah tell a live caller their callback failed). So this has to be
  -- checked, not assumed.
  IF EXISTS (
    SELECT 1 FROM public.scheduled_calls
     WHERE lead_id      = p_lead_id
       AND called_at    IS NULL
       AND cancelled_at IS NULL
       AND skipped_at   IS NULL
  ) THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'pending_call_exists');
  END IF;

  -- Which rung? Counts every ladder row for this lead regardless of how it
  -- settled. A rung staff cancelled still advances the counter — erring toward
  -- fewer calls, never more.
  SELECT coalesce(max(followup_attempt), 0) + 1 INTO v_attempt
    FROM public.scheduled_calls
   WHERE lead_id = p_lead_id AND followup_attempt IS NOT NULL;

  v_days := CASE v_attempt
              WHEN 1 THEN 1
              WHEN 2 THEN 2
              WHEN 3 THEN 3
              WHEN 4 THEN 5
            END;

  IF v_days IS NULL THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'ladder_exhausted',
                              'attempts_made', v_attempt - 1);
  END IF;

  -- leads.available is free text, not an enum: 'Daytime', 'Evening', 'Weekend',
  -- 'justForFun, Evening', 'weddingDance - Daytime', 'not interested anymore'.
  -- Substring, therefore, not equality. Everything that is not explicitly an
  -- evening preference — including the ~55% of leads where it is NULL, and
  -- 'Weekend', which names a day and not a time — falls back to 13:00. That is
  -- the only default inside every studio's window on every day they are open.
  v_time := CASE
              WHEN position('evening' in lower(coalesce(v_lead.available, ''))) > 0
              THEN time '18:30'
              ELSE time '13:00'
            END;

  -- Measured from now — i.e. from the call that just went unanswered — not from
  -- the previous row's callback_time. The client's wording says "after the
  -- previous call", and it is the only reading that stays correct when the Call
  -- Window Gate holds a row over a closed weekend.
  --
  -- Wall-clock arithmetic in the studio's own zone, then converted back, so a
  -- ladder spanning a DST changeover still lands at 13:00 and not 12:00.
  v_target := ((timezone(v_tz, now())::date + v_days) + v_time) AT TIME ZONE v_tz;

  -- Denormalised callee snapshot, per 053: a lead rename or delete must not
  -- change what an already-queued call says.
  --
  -- Collapse whitespace BEFORE splitting. `leads.name` is user- and webhook-fed
  -- and does contain stray leading spaces; splitting "  Ann  Lee" raw yields an
  -- empty first_name, and first_name is the dynamic variable the agent greets
  -- the lead with — so the call opens addressing nobody.
  v_name  := btrim(regexp_replace(coalesce(v_lead.name, ''), '\s+', ' ', 'g'));
  v_first := nullif(split_part(v_name, ' ', 1), '');
  v_last  := nullif(btrim(substr(v_name, length(split_part(v_name, ' ', 1)) + 2)), '');

  INSERT INTO public.scheduled_calls (
    studio_id, lead_id,
    first_name, last_name, phone_number, email,
    reason, call_note,
    callback_time, source,
    followup_attempt, followup_triggered_by_call_id
  ) VALUES (
    p_studio_id, p_lead_id,
    v_first, v_last, v_lead.phone, v_lead.email,
    v_reason,
    -- Same vocabulary as the /follow-ups badge: the ladder is 5 calls total, and
    -- v_attempt counts only the automatic retries, so rung 1 is attempt 2 of 5.
    format('Automatic follow-up — attempt %s of 5. No answer on the previous call.', v_attempt + 1),
    v_target, 'followup',
    v_attempt, p_retell_call_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'queued',        true,
    'scheduled_call_id', v_new_id,
    'attempt',       v_attempt,
    'days_out',      v_days,
    'callback_time', v_target,
    'local_time',    to_char(timezone(v_tz, v_target), 'YYYY-MM-DD HH24:MI'),
    'timezone',      v_tz
  );

EXCEPTION
  -- The unique index is the real guard against a concurrent webhook retry; this
  -- turns the race into the same answer the pre-check would have given.
  WHEN unique_violation THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'already_queued_for_call');
END;
$$;

COMMENT ON FUNCTION public.schedule_followup_call(uuid, uuid, text) IS
  'Queues the next rung of the no-answer follow-up ladder (+1/+2/+3/+5 days at the lead''s preferred time). Called by the did_not_answer branch of each Voice AI Functions workflow. No-ops with reason ''followups_disabled'' when studios.followups_enabled is false, or ''do_not_disturb'' when leads.dnd is true (migration 063). Returns {queued, reason|attempt, ...}. See docs/specs/automatic-followup-calls.md.';

-- ── Privileges ───────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE preserves the existing ACL, so these are a no-op against the
-- live database as it stands. Re-issued anyway: rebuilding the schema from
-- migrations alone would otherwise restore the default PUBLIC/anon/authenticated
-- grants, which on a SECURITY DEFINER argument-driven function with no membership
-- check is an RLS bypass letting anon queue outbound calls. See 061 §5 / 062.
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_followup_call(uuid, uuid, text) TO service_role;

-- ── The other half ───────────────────────────────────────────────────────────
--
-- This file (plus the app's scheduleCall guard) only stops NEW calls. Holding the
-- ones already queued happens in the dialer, because that is the only code that
-- decides whether a due row gets dialled. In each Voice AI Functions workflow the
-- `Call Window Gate` must, in addition to its call-hours and followups_enabled
-- checks, look up the row's lead and hold when leads.dnd is true — same return-[]
-- hold-and-resume it already does for out-of-hours rows.
