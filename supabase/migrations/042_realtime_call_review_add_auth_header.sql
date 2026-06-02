-- Migration 042: Add Authorization header to trigger_realtime_call_review()'s pg_net call
--
-- Background: pg_net.http_post() does NOT auto-attach the service role JWT (verified
-- empirically — request 546 returned 401 with UNAUTHORIZED_NO_AUTH_HEADER). The
-- analyze-single-call edge function has verify_jwt=true, so the gateway rejects
-- requests without a JWT before our internal x-cron-secret check ever runs.
--
-- Mirroring the working daily-call-review cron schedule, we now send:
--   Authorization: Bearer <legacy anon JWT>  -- satisfies the gateway's verify_jwt
--   x-cron-secret: <secret>                  -- our function's internal auth check
--
-- Both values come from supabase_vault:
--   vault.decrypted_secrets WHERE name = 'analyze_single_call_url'
--   vault.decrypted_secrets WHERE name = 'cron_secret'
--   vault.decrypted_secrets WHERE name = 'supabase_anon_jwt'

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
  v_anon_jwt text;
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

  -- Idempotency.
  SELECT EXISTS (
    SELECT 1 FROM call_reviews WHERE call_id = NEW.id
  ) INTO v_already_reviewed;
  IF v_already_reviewed THEN
    RETURN NEW;
  END IF;

  -- Read all three config values from Vault.
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'analyze_single_call_url'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;

  SELECT decrypted_secret INTO v_anon_jwt
  FROM vault.decrypted_secrets
  WHERE name = 'supabase_anon_jwt'
  LIMIT 1;

  IF v_url IS NULL OR v_url = ''
     OR v_secret IS NULL OR v_secret = ''
     OR v_anon_jwt IS NULL OR v_anon_jwt = '' THEN
    RAISE LOG 'trigger_realtime_call_review: missing one of (analyze_single_call_url, cron_secret, supabase_anon_jwt) Vault secrets; skipping call %', NEW.id;
    RETURN NEW;
  END IF;

  -- Fire-and-forget POST to the edge function via pg_net.
  -- Authorization header satisfies the gateway's verify_jwt check; x-cron-secret
  -- is verified inside the function body.
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon_jwt,
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('call_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'trigger_realtime_call_review failed for call %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;
