-- Migration 062: a per-studio switch for the automatic follow-up ladder.
--
-- THE RULE (Joshua, 2026-08-06)
--
--   "can you add a switch in the system dashboard somewhere that can turn
--    automatic followups on and off? it shouldn't affect the normal behavior of
--    the agent tho, only followups"
--
-- So this is emphatically NOT a second voice-agent pause. With the switch off the
-- agent still answers inbound calls, still dials new inquiries, still books, still
-- escalates. The only thing that stops is the no-answer ladder from migration 061.
--
-- Full spec: docs/specs/automatic-followup-calls.md
--
-- WHAT "OFF" MEANS: HOLD, NOT CANCEL
--
-- Chosen deliberately over the alternative. Switching off does two things:
--
--   1. No NEW rungs are queued.       <- this file, the guard below
--   2. Rungs ALREADY queued are held. <- the dialer's `Call Window Gate`
--
-- Held means exactly what it means for an out-of-hours row: the dialer declines to
-- dial and leaves the row PENDING (called_at / cancelled_at / skipped_at all stay
-- NULL), so switching back on resumes it at its original callback_time. Flipping
-- the switch twice loses nothing. A studio can go quiet for a weekend without
-- destroying eleven days of in-flight ladders.
--
-- This is the opposite of what migration 054 does to the voice-agent pause, where
-- resuming ABANDONS the backlog. That asymmetry is intentional and worth stating:
-- 054 exists because a studio that has been dark for a week should not suddenly
-- cold-call a stale list. A follow-up rung is not a stale list — it is one lead the
-- agent already spoke to (or tried to), on a schedule the lead was effectively
-- promised. Resuming it is the expected behaviour, not a surprise.
--
-- WHY THE GUARD LIVES HERE
--
-- Same reasoning as 059 and 061: the ladder's product decisions live in one
-- function, so a fourth studio inherits them by calling it. Putting the on/off test
-- in the four n8n workflows instead would be four places to forget.
--
-- NOT AFFECTED: the 054 purge trigger is `AFTER UPDATE OF voice_agent_enabled`
-- with a `WHEN (OLD IS FALSE AND NEW IS TRUE)` clause, so writing these new columns
-- cannot trip it. Verified before writing this migration — if that trigger ever
-- widens to a bare `AFTER UPDATE`, toggling follow-ups would silently wipe every
-- pending call in the studio.

-- ── Columns ──────────────────────────────────────────────────────────────────
--
-- Mirrors the voice_agent_* trio from migration 031 so the two switches are read
-- and audited the same way. NOT NULL DEFAULT true: every existing studio keeps the
-- behaviour it has today, and a studio row that predates this migration can never
-- read as "off" by accident.

ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS followups_enabled   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS followups_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS followups_paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.studios.followups_enabled IS
  'Master switch for the automatic no-answer follow-up ladder (migration 061). false = queue no new rungs AND hold the ones already queued. Does not affect inbound answering, outbound dialing of new inquiries, or anything else the voice agent does — that is studios.voice_agent_enabled.';
COMMENT ON COLUMN public.studios.followups_paused_at IS
  'When followups_enabled was last set false. Cleared on switch-on.';
COMMENT ON COLUMN public.studios.followups_paused_by IS
  'Who set followups_enabled false. Cleared on switch-on.';

-- ── The guard ────────────────────────────────────────────────────────────────
--
-- Re-issues schedule_followup_call from migration 061 with one new early return.
-- Everything else is byte-identical to the deployed function; the diff is the
-- studio read moving up (it was already happening, just later, for the timezone)
-- and the followups_enabled test that read now feeds.
--
-- Reading the studio earlier costs nothing — the function always needed that row —
-- and it means a studio with follow-ups off does the least possible work per
-- unanswered call.

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

  -- The switch. Deliberately the first thing tested after the arguments: when a
  -- studio has follow-ups off, an unanswered call should cost one indexed lookup
  -- and nothing else.
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
  'Queues the next rung of the no-answer follow-up ladder (+1/+2/+3/+5 days at the lead''s preferred time). Called by the did_not_answer branch of each Voice AI Functions workflow. No-ops with reason ''followups_disabled'' when studios.followups_enabled is false. Returns {queued, reason|attempt, ...}. See docs/specs/automatic-followup-calls.md.';

-- ── Privileges ───────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE preserves the existing ACL, so these are a no-op against the
-- live database as it stands. Re-issued anyway: the day someone rebuilds this
-- schema from migrations alone, the default grants (PUBLIC / anon / authenticated
-- on every new function in `public`) would otherwise come back, and combined with
-- SECURITY DEFINER on an argument-driven function with no membership check that is
-- an RLS bypass letting anon queue outbound calls for any studio. See 061 §5.
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_followup_call(uuid, uuid, text) TO service_role;

-- ── The other half ───────────────────────────────────────────────────────────
--
-- This file only stops NEW rungs. Holding the ones already queued happens in the
-- dialer, because that is the only code that decides whether a due row gets
-- dialled. In each Voice AI Functions workflow:
--
--   `Check Voice Agent Setting`  ->  add followups_enabled to the select
--   `Call Window Gate`           ->  hold the row when it is a follow-up and the
--                                    studio has follow-ups off
--
-- The gate already implements hold-and-resume for out-of-hours rows (return [],
-- leave the row pending, re-read next sweep), so the follow-up hold is the same
-- mechanism pointed at a different column. An absent followups_enabled reads as
-- true there, so the two edits are order-independent and neither can turn a
-- studio's follow-ups off by half-deploying.
