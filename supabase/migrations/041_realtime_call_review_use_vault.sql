-- Migration 041: Switch trigger_realtime_call_review() from GUCs to Supabase Vault
--
-- Background: Migration 040 used `current_setting('app.xxx', true)` to read the
-- edge function URL and cron secret. Supabase managed Postgres blocks
-- `ALTER DATABASE postgres SET app.xxx = ...` (permission denied even for the
-- project owner), so the GUC approach is non-functional.
--
-- This migration:
--   - Rewrites the trigger function body to read from vault.decrypted_secrets
--   - Adds 'vault' to the SET search_path of the function
--   - Leaves the triggers themselves untouched (they reference the function by name)
--
-- Prerequisites (set out-of-band, NOT in this migration since secrets shouldn't
-- live in version control):
--   SELECT vault.create_secret('<edge fn URL>', 'analyze_single_call_url', 'description');
--   SELECT vault.create_secret('<cron secret>', 'cron_secret', 'description');
--
-- If either Vault secret is missing, the trigger function logs and returns NEW
-- silently — calls writes are never blocked.

CREATE OR REPLACE FUNCTION trigger_realtime_call_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
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

  -- Read config from Supabase Vault.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'analyze_single_call_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE LOG 'trigger_realtime_call_review: missing Vault secret analyze_single_call_url or cron_secret; skipping call %', NEW.id;
    RETURN NEW;
  END IF;

  -- Fire-and-forget POST to the edge function via pg_net.
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
