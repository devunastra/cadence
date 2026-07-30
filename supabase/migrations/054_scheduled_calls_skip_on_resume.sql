-- Migration 054: resuming a paused voice agent discards its queued backlog.
--
-- THE RULE (Joshua, 2026-07-30)
--
--   "when i turn on the agent, dont dial anyone, dial only the future leads who
--    will come after the switch on"
--
-- Pausing a studio's voice agent must not merely *defer* its queued calls. When the
-- agent is switched back on, everything already queued is abandoned; only calls
-- queued after that moment are dialled.
--
-- WHY THIS IS A TRIGGER AND NOT DIALER LOGIC
--
-- The obvious implementation — have the dialer's `Voice Agent Enabled?` guard stamp
-- rows it declines to dial — is wrong. It only ever sees rows that are *due*. A row
-- queued during the pause with a callback_time next week is never due while paused,
-- so it would survive the pause untouched and get dialled later. That is precisely
-- the case the rule forbids.
--
-- The switch itself is the only correct trigger point: at the false -> true
-- transition, every still-pending row for that studio is abandoned regardless of
-- when it was due.
--
-- Firing in the database rather than in `app/actions.ts` means it holds no matter
-- who flips the column — the Settings toggle, a SQL console, a future service — and
-- it is atomic with the flip. There is no window in which the agent is on and a
-- stale row is still dialable.
--
-- WHY A NEW COLUMN INSTEAD OF REUSING cancelled_at
--
-- `cancelled_at` means "a human cancelled this". Reusing it here would repeat the
-- exact overloading of `called_at` that migration 053 exists to undo, and would
-- misattribute a system action to staff in the audit trail. Three outcomes, three
-- columns: called_at / cancelled_at / skipped_at.

ALTER TABLE public.scheduled_calls
  ADD COLUMN IF NOT EXISTS skipped_at  timestamptz,
  ADD COLUMN IF NOT EXISTS skip_reason text;

COMMENT ON COLUMN public.scheduled_calls.skipped_at IS
  'Stamped when the system abandons a queued call without dialling it. Distinct from called_at (dialled) and cancelled_at (a human cancelled). Pending = all three NULL.';
COMMENT ON COLUMN public.scheduled_calls.skip_reason IS
  'Why the row was abandoned. Currently only ''voice_agent_resumed''.';

-- ── Pending now means three NULLs, so the hot-path index must agree ───────────
-- Without this the dialer's index stops matching its own WHERE clause and the
-- partial index silently goes unused.

DROP INDEX IF EXISTS idx_scheduled_calls_due;
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_due
  ON public.scheduled_calls (callback_time)
  WHERE called_at IS NULL AND cancelled_at IS NULL AND skipped_at IS NULL;

-- ── The trigger ──────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER: the purge is a system action and must complete regardless of
-- which role flipped the switch. Without it the UPDATE would be filtered by the
-- caller's RLS policy on scheduled_calls, so a studio_owner resuming their agent
-- could leave rows behind — a silent partial purge, the worst outcome.
-- search_path is pinned per Postgres SECURITY DEFINER guidance.

CREATE OR REPLACE FUNCTION public.skip_pending_calls_on_voice_agent_resume()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.scheduled_calls
     SET skipped_at   = now(),
         skip_reason  = 'voice_agent_resumed'
   WHERE studio_id    = NEW.id
     AND called_at    IS NULL
     AND cancelled_at IS NULL
     AND skipped_at   IS NULL;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.skip_pending_calls_on_voice_agent_resume() IS
  'Abandons every still-pending scheduled_calls row for a studio when its voice agent is switched back on. See migration 054.';

DROP TRIGGER IF EXISTS studios_voice_agent_resume_skips_backlog ON public.studios;
CREATE TRIGGER studios_voice_agent_resume_skips_backlog
  AFTER UPDATE OF voice_agent_enabled ON public.studios
  FOR EACH ROW
  WHEN (OLD.voice_agent_enabled IS FALSE AND NEW.voice_agent_enabled IS TRUE)
  EXECUTE FUNCTION public.skip_pending_calls_on_voice_agent_resume();

-- ── Callers that must also learn about skipped_at ─────────────────────────────
--
-- Anything selecting pending rows needs `skipped_at IS NULL` too, or abandoned rows
-- get re-read and dialled — which would defeat the whole migration:
--
--   app/actions.ts  fetchScheduledCalls   -> .is('skipped_at', null)
--   n8n `Get row(s)` filterString in ALL FOUR workflows -> &skipped_at=is.null
--     gcDhc61cSLTPXOKv  Voice AI Functions (Lincolnshire)
--     Wgg5bQTPJYFsDSn8  Voice AI Functions (AM Schaumburg)
--     QNRW2PHkiY0i3dij  Voice AI Functions (AM White Rock)
--     LXlMa0Gy2Fq2xuUO  Voice AI Functions copy (Joshua)
--
-- NOTE ON THE EXISTING BACKLOG: Schaumburg and White Rock are both currently
-- voice_agent_enabled = false. Their queued rows are therefore purged automatically
-- the first time either is switched on — no manual cleanup needed. Schaumburg's four
-- (Susan Krussel, Pauline Salcedo, Cole Keller, Chris Kim) are all still in `leads`
-- with their inquiry text if anyone wants to call them by hand.
