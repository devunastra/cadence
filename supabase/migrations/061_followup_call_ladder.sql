-- Migration 061: automatic follow-up calls — the no-answer ladder.
--
-- THE RULE (client, 2026-08-05)
--
--   "if the lead doesn't pick up, they get called again the next day within their
--    preference window (evening 6:30pm, daytime 1:00pm) ... 2 days after the
--    previous call ... 3 days after the previous call ... and the LAST call will
--    be one more time 5 days after the previous call"
--
-- Attempt 1 is the original call, whatever produced it. Then +1, +2, +3, +5 days:
-- five calls across eleven days, four of them automatic.
--
-- Full spec, including the decisions behind the defaults:
--   docs/specs/automatic-followup-calls.md
--
-- WHY AN RPC AND NOT LADDER LOGIC IN N8N
--
-- Same reasoning as migration 059 (notify_ai_escalation): the intervals, the
-- preference-window mapping and the stop conditions are product decisions, not
-- workflow plumbing. Encoded once here, a fourth studio gets correct follow-ups
-- by adding one HTTP node. Encoded in n8n, they get the copy-paste drift that
-- migrations 053 and 056 exist to undo.
--
-- WHAT CALLS THIS
--
-- The `If2` true branch (call_action == 'did_not_answer') in each Voice AI
-- Functions workflow, after `Upsert Call (ended)`. That classifier is already the
-- system's definition of "didn't pick up" — it is reused rather than restated, so
-- the two halves cannot drift.
--
-- This migration is purely additive. Until a workflow calls the function nothing
-- happens, so it is safe to land ahead of any n8n change.

-- ── Columns ──────────────────────────────────────────────────────────────────

ALTER TABLE public.scheduled_calls
  ADD COLUMN IF NOT EXISTS followup_attempt              smallint,
  ADD COLUMN IF NOT EXISTS followup_triggered_by_call_id text;

COMMENT ON COLUMN public.scheduled_calls.followup_attempt IS
  'Which rung of the no-answer ladder this row is (1-4). NULL = not part of a ladder, which is every row written by the inquiry workflows, the Retell schedule_ai_callback tool, and staff.';
COMMENT ON COLUMN public.scheduled_calls.followup_triggered_by_call_id IS
  'The retell_call_id whose no-answer produced this row. Idempotency key — a webhook retry must not add a rung.';

-- 'followup' is a third provenance alongside the existing two.
ALTER TABLE public.scheduled_calls DROP CONSTRAINT IF EXISTS scheduled_calls_source_check;
ALTER TABLE public.scheduled_calls ADD CONSTRAINT scheduled_calls_source_check
  CHECK (source IN ('ai_agent', 'manual', 'followup'));

-- One Retell call can spawn at most one follow-up, ever. Enforced by the index
-- rather than only by the function body, so it holds under concurrent webhook
-- retries too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_calls_followup_dedupe
  ON public.scheduled_calls (followup_triggered_by_call_id)
  WHERE followup_triggered_by_call_id IS NOT NULL;

-- Counting a lead's existing rungs is the function's hot path.
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_lead_followup
  ON public.scheduled_calls (lead_id, followup_attempt)
  WHERE followup_attempt IS NOT NULL;

-- ── The function ─────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER: n8n authenticates with the service role, but pinning this
-- makes the function independent of who calls it, matching 054 and 059.
--
-- Returns jsonb rather than void so the n8n node can be inspected in an execution
-- log without a second query. Every early return names its reason — a silently
-- skipped follow-up is the failure mode that took a week to notice last time
-- (see the note in 053 about out-of-hours leads going uncalled).

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

  -- Cheapest check first, and the one a webhook retry actually hits.
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

  SELECT coalesce(nullif(btrim(timezone), ''), 'America/Chicago')
    INTO v_tz FROM public.studios WHERE id = p_studio_id;
  v_tz := coalesce(v_tz, 'America/Chicago');

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
  'Queues the next rung of the no-answer follow-up ladder (+1/+2/+3/+5 days at the lead''s preferred time). Called by the did_not_answer branch of each Voice AI Functions workflow. Returns {queued, reason|attempt, ...}. See docs/specs/automatic-followup-calls.md.';

-- ── Privileges: REVOKE FIRST, and do not skip this ───────────────────────────
--
-- Supabase's default privileges grant EXECUTE on every new function in `public`
-- to PUBLIC, anon and authenticated. Combined with SECURITY DEFINER that is a
-- straightforward RLS bypass: this function takes studio_id and lead_id as
-- arguments and performs NO membership check, so with the default grants in
-- place anyone holding the anon key — which ships in the browser as
-- NEXT_PUBLIC_SUPABASE_ANON_KEY — could queue outbound phone calls against any
-- studio, and any authenticated user of studio A could queue calls for studio B.
--
-- Verified on the live database 2026-08-05: the ACL immediately after CREATE was
--   =X/postgres  postgres=X/postgres  anon=X/postgres
--   authenticated=X/postgres  service_role=X/postgres
-- i.e. exactly that hole. After these statements it reads
--   postgres=X/postgres  service_role=X/postgres
--
-- Only the n8n workflows call this, and they authenticate as service_role.
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.schedule_followup_call(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_followup_call(uuid, uuid, text) TO service_role;

-- If this ever needs to be callable from the app (a "retry now" button, say),
-- do NOT re-grant to authenticated. Add an explicit membership check against
-- studio_users at the top of the function first — the argument-driven signature
-- is only safe while the caller is trusted.

-- ── Not changed, on purpose ──────────────────────────────────────────────────
--
-- The migration-054 purge still abandons follow-up rows when a studio's voice
-- agent is switched back on: they are pending rows like any other. Confirmed as
-- intended 2026-08-05. A studio that pauses for a week returns with every
-- in-flight ladder wiped, and nothing announces it. Revisit if that surprises
-- anyone in practice.
