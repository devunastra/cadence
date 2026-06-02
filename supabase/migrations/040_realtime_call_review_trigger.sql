-- Migration 040: Realtime call review trigger
-- Fires `analyze-single-call` edge function via pg_net.http_post on INSERT or
-- transcript-bearing UPDATE to public.calls, so the Result column in Call History
-- reflects the AI review within ~60s instead of waiting up to 31h for the daily cron.
--
-- Safety properties:
-- 1. Fire-and-forget via pg_net — trigger never blocks INSERT/UPDATE on calls.
-- 2. Entire function body wrapped in EXCEPTION WHEN OTHERS — even pg_net failure
--    cannot break a calls write.
-- 3. Eligibility filters mirror daily-call-review exactly:
--      - skip if studios.review_enabled = false
--      - skip if voicemail
--      - skip if duration_seconds is null or <= 15
--      - skip if transcript is null/empty
--      - skip if a call_reviews row already exists (idempotent)
-- 4. UPDATE trigger only fires when transcript actually changes.
--
-- GUCs read by the trigger (set via ALTER DATABASE postgres SET app.xxx = '...'):
--   app.analyze_single_call_url — full URL of the edge function
--   app.cron_secret              — same secret as daily-call-review uses
-- If either GUC is missing, the function logs and returns NEW silently.

-- 1. Allow 'realtime' as a trigger_type value alongside 'manual' and 'cron'.
ALTER TABLE call_reviews DROP CONSTRAINT IF EXISTS call_reviews_trigger_type_check;
ALTER TABLE call_reviews ADD CONSTRAINT call_reviews_trigger_type_check
  CHECK (trigger_type IN ('manual', 'cron', 'realtime'));

-- 2. Per-studio enablement flag. Default true keeps existing studios reviewing
--    exactly as before; Phase B will surface a UI toggle to flip this per studio.
ALTER TABLE studios ADD COLUMN IF NOT EXISTS review_enabled boolean NOT NULL DEFAULT true;

-- 3. The trigger function. Defensive — any internal failure is swallowed so the
--    underlying INSERT/UPDATE on calls always succeeds.
CREATE OR REPLACE FUNCTION trigger_realtime_call_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_review_enabled boolean;
  v_already_reviewed boolean;
  v_url text;
  v_secret text;
BEGIN
  -- Cheap eligibility checks, fail fast.
  IF NEW.voicemail = true THEN
    RETURN NEW;
  END IF;
  IF NEW.transcript IS NULL OR length(trim(NEW.transcript)) = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.duration_seconds IS NULL OR NEW.duration_seconds <= 15 THEN
    RETURN NEW;
  END IF;

  -- Per-studio enablement.
  SELECT review_enabled INTO v_review_enabled
  FROM studios
  WHERE id = NEW.studio_id;
  IF NOT FOUND OR v_review_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if a review already exists for this call_id.
  SELECT EXISTS (
    SELECT 1 FROM call_reviews WHERE call_id = NEW.id
  ) INTO v_already_reviewed;
  IF v_already_reviewed THEN
    RETURN NEW;
  END IF;

  -- Read config; if missing, log and exit cleanly (trigger never blocks write).
  v_url := current_setting('app.analyze_single_call_url', true);
  v_secret := current_setting('app.cron_secret', true);
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'trigger_realtime_call_review: missing app.analyze_single_call_url or app.cron_secret GUC; skipping call %', NEW.id;
    RETURN NEW;
  END IF;

  -- Fire-and-forget POST to the edge function.
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('call_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never let a trigger failure block the INSERT/UPDATE on calls.
    RAISE LOG 'trigger_realtime_call_review failed for call %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

-- 4. INSERT trigger — fires for every new calls row.
DROP TRIGGER IF EXISTS calls_realtime_review_on_insert ON public.calls;
CREATE TRIGGER calls_realtime_review_on_insert
  AFTER INSERT ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION trigger_realtime_call_review();

-- 5. UPDATE trigger — fires only when transcript transitions to a new value.
--    Catches the n8n pattern of inserting a calls row first, then patching the
--    transcript in a second write.
DROP TRIGGER IF EXISTS calls_realtime_review_on_transcript_update ON public.calls;
CREATE TRIGGER calls_realtime_review_on_transcript_update
  AFTER UPDATE OF transcript ON public.calls
  FOR EACH ROW
  WHEN (OLD.transcript IS DISTINCT FROM NEW.transcript)
  EXECUTE FUNCTION trigger_realtime_call_review();

-- 6. Add call_reviews to the realtime publication so the UI can subscribe
--    to INSERT/UPDATE events for live "Pending Review" → final-result flips.
--    Idempotent: ALTER PUBLICATION ADD TABLE is not idempotent natively, so we
--    guard it with a NOT EXISTS check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'call_reviews'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_reviews;
  END IF;
END $$;
