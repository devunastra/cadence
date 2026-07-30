-- Migration 053: move the AI callback queue out of n8n data tables into Postgres.
--
-- WHY THIS EXISTS
--
-- Until now the "call this person at time T" queue lived in n8n data tables, one
-- per studio: `9U0GXNR5uRUTWUPy` (Lincolnshire) and `VmEyZDyEjnlYEIBb`
-- (Schaumburg). Rows carried no studio_id, so tenant ownership had to be
-- reverse-engineered by phone-matching against `leads` in application code
-- (see the pre-053 fetchScheduledCallbacks in app/actions.ts).
--
-- That design failed twice in the same way: the Schaumburg dialer was cloned and
-- left pointing at Lincolnshire's live queue (caught before go-live, see
-- docs/n8n-schaumburg-build-log.md), and the White Rock clone reproduced the
-- identical mispointing. Tenant isolation was a dropdown in a node config.
--
-- One table with a real studio_id + RLS makes isolation structural. A new studio
-- needs zero n8n changes.
--
-- WHAT STAYS IN N8N
--
-- The dialer itself. n8n keeps the 30-minute schedule trigger, the Retell
-- create-phone-call request, and the whole post-dial chain (field options,
-- Notion, lead update). Only the storage moves: the data-table nodes become
-- Supabase nodes against this table. That keeps the risky part of the system
-- untouched.
--
-- CANCEL IS NO LONGER AN OVERLOADED called_at
--
-- The old cancel path stamped `called_at = now()` to hide a row, so "we called
-- them" and "staff cancelled it" were indistinguishable, and cancel had to match
-- on phone_number (the data-table node could not filter the synthetic id), which
-- neutralised *every* pending row for that phone. Here they are separate
-- columns and cancel targets one row by primary key.
--
-- NO UNIQUE CONSTRAINT ON PENDING ROWS — DELIBERATE
--
-- A partial unique index on (studio_id, phone_number) WHERE pending would be
-- tempting, but the Retell `schedule_ai_callback` insert has
-- onError: continueErrorOutput wired to an "Unsuccessful Callback Schedule"
-- response, so a constraint violation would make Sarah tell a live caller the
-- callback failed. Duplicate pending rows were already possible pre-053; this
-- migration deliberately does not change that behaviour. The app detects an
-- existing pending row and offers to reschedule instead. Revisit once the
-- Retell path can handle a rejection gracefully.

CREATE TABLE IF NOT EXISTS public.scheduled_calls (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  studio_id         uuid        NOT NULL REFERENCES studios(id) ON DELETE CASCADE,

  -- Nullable: a caller who reaches the agent may not exist in `leads` yet. The
  -- dialer does not need it (it passes the snapshot below straight to Retell);
  -- the UI uses it to link the row to a lead when one is known.
  lead_id           uuid        REFERENCES leads(id) ON DELETE SET NULL,

  -- Callee snapshot, denormalised on purpose. These become Retell dynamic
  -- variables at dial time, so a lead rename — or a lead delete — must not
  -- change what an already-queued call says. Mirrors the old data-table columns
  -- one-for-one so the n8n node mapping is a rename, not a rewrite.
  first_name        text,
  last_name         text,
  phone_number      text        NOT NULL,   -- E.164, normalised by the writer
  email             text,
  dance_interest    text,
  reason            text,                   -- the lead's dance reason: Wedding / For Fun / ...

  -- New in 053. `reason` above is a lead enum consumed by the post-dial field-
  -- option resolver, so it was never free-text and had nowhere to hold "why are
  -- we calling this person back". Manual schedules need that context.
  -- Named call_note, not note, to stay unambiguous alongside `leads.notes`.
  call_note         text,

  callback_time     timestamptz NOT NULL,
  called_at         timestamptz,
  retell_call_id    text,

  source            text        NOT NULL DEFAULT 'ai_agent'
                                CHECK (source IN ('ai_agent', 'manual')),
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  cancelled_at      timestamptz,
  cancelled_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scheduled_calls IS
  'Queue of future outbound AI calls. Written by the app (source=manual) and by the Retell schedule_ai_callback tool via n8n (source=ai_agent). Drained by the n8n AI Callback Trigger every 30 min.';
COMMENT ON COLUMN public.scheduled_calls.called_at IS
  'Stamped by the n8n dialer after Retell accepts the call. NULL + cancelled_at NULL = still pending.';
COMMENT ON COLUMN public.scheduled_calls.cancelled_at IS
  'Stamped when staff cancel from /follow-ups. Distinct from called_at so the two outcomes stay distinguishable.';
COMMENT ON COLUMN public.scheduled_calls.call_note IS
  'Free-text context for why this call is queued. Surfaced to the agent as a dynamic variable.';

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- The dialer's hot path, run every 30 minutes per studio:
--   WHERE called_at IS NULL AND cancelled_at IS NULL AND callback_time <= now()
-- Partial so it only indexes pending rows — the table's steady state is almost
-- entirely settled rows, and those never need to be scanned.
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_due
  ON public.scheduled_calls (callback_time)
  WHERE called_at IS NULL AND cancelled_at IS NULL;

-- The /follow-ups list view, always scoped to one studio.
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_studio_time
  ON public.scheduled_calls (studio_id, callback_time DESC);

CREATE INDEX IF NOT EXISTS idx_scheduled_calls_lead
  ON public.scheduled_calls (lead_id)
  WHERE lead_id IS NOT NULL;

-- ── updated_at ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_scheduled_calls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scheduled_calls_updated_at ON public.scheduled_calls;
CREATE TRIGGER scheduled_calls_updated_at
  BEFORE UPDATE ON public.scheduled_calls
  FOR EACH ROW EXECUTE FUNCTION update_scheduled_calls_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
--
-- Studio-scoped for every role. super_admin reads go through the service client
-- (getAuthorizedClient in app/actions.ts) and bypass RLS, same as every other
-- table. The n8n dialer authenticates with the service role.
--
-- studio_staff CAN schedule and cancel: front desk booking a follow-up is the
-- feature's primary use case, and staff could already cancel pre-053. The
-- expensive/destructive studio-wide switch (voice_agent_enabled) stays
-- owner-only via the existing policy from migration 031.

ALTER TABLE public.scheduled_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view scheduled calls for their studios" ON public.scheduled_calls;
CREATE POLICY "Users can view scheduled calls for their studios"
  ON public.scheduled_calls FOR SELECT
  USING (
    studio_id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can schedule calls for their studios" ON public.scheduled_calls;
CREATE POLICY "Users can schedule calls for their studios"
  ON public.scheduled_calls FOR INSERT
  WITH CHECK (
    studio_id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
    )
    -- Attribution cannot be forged: a client-supplied created_by that is not the
    -- caller is rejected outright.
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Users can cancel scheduled calls for their studios" ON public.scheduled_calls;
CREATE POLICY "Users can cancel scheduled calls for their studios"
  ON public.scheduled_calls FOR UPDATE
  USING (
    studio_id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
    )
  )
  WITH CHECK (
    studio_id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

-- No DELETE policy. Cancelling is a soft stamp so the audit trail survives.

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Lets the Scheduled Callbacks tab update live when the dialer settles a row or
-- another staff member schedules one. FULL replica identity so UPDATE payloads
-- carry the old record (needed to filter transitions client-side), matching
-- `leads` from migration 008.

ALTER TABLE public.scheduled_calls REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'scheduled_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_calls;
  END IF;
END $$;

-- ── Cutover (NOT run by this migration) ──────────────────────────────────────
--
-- This migration is purely additive: nothing reads or writes scheduled_calls
-- until the app deploy and the n8n node swap land. The n8n data tables remain
-- the source of truth until then.
--
-- At cutover, carry over the still-pending rows. At the time of writing that is
-- exactly ONE row across both data tables (Lincolnshire id 106, Jacob Finegan,
-- callback_time 2026-08-03T16:00:00Z) because the 30-minute dialer keeps the
-- queue drained. Re-check both tables immediately before running this, since a
-- live caller can add a row at any time:
--
--   INSERT INTO public.scheduled_calls
--     (studio_id, lead_id, first_name, last_name, phone_number, email,
--      dance_interest, reason, callback_time, source)
--   SELECT
--     '71274499-7c29-4621-990f-b60669ed1de3',       -- Arthur Murray Lincolnshire
--     l.id,
--     'Jacob', 'Finegan', '+19062352500', 'jfinegan715@gmail.com',
--     'Looking to understand costs of dance lessons for a date night with my wife. Potentially five classes.',
--     'For Fun',
--     '2026-08-03T16:00:00Z',
--     'ai_agent'
--   FROM public.leads l
--   WHERE l.studio_id = '71274499-7c29-4621-990f-b60669ed1de3'
--     AND regexp_replace(l.phone, '\D', '', 'g') LIKE '%9062352500'
--   LIMIT 1;
--
-- Then stamp the source rows as handled so a mid-cutover n8n tick cannot
-- double-dial them, and only then enable the Supabase-backed nodes.
