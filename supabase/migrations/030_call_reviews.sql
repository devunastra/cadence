-- Migration 030: call_reviews table for Transcript Analyzer feature
-- Stores AI-graded call quality reviews from OpenAI GPT-5.5

CREATE TABLE call_reviews (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id             uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  studio_id           uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  grade               text NOT NULL CHECK (grade IN ('Pass', 'Fail')),
  summary             text,
  agent_mistakes      jsonb DEFAULT '[]'::jsonb,
  user_repeats        integer DEFAULT 0,
  booking_attempted   boolean,
  booking_successful  boolean,
  objections          jsonb DEFAULT '[]'::jsonb,
  callback_requested  boolean DEFAULT false,
  follow_up_needed    boolean DEFAULT false,
  follow_up_reason    text,
  topics_discussed    jsonb DEFAULT '[]'::jsonb,
  raw_ai_response     jsonb,
  model_used          text DEFAULT 'gpt-5.5',
  trigger_type        text NOT NULL CHECK (trigger_type IN ('manual', 'cron')),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  CONSTRAINT call_reviews_call_id_key UNIQUE (call_id)
);

-- Auto-update updated_at on upsert
CREATE OR REPLACE FUNCTION update_call_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER call_reviews_updated_at
  BEFORE UPDATE ON call_reviews
  FOR EACH ROW EXECUTE FUNCTION update_call_reviews_updated_at();

-- Indexes
CREATE INDEX idx_call_reviews_studio_id ON call_reviews(studio_id);
CREATE INDEX idx_call_reviews_grade ON call_reviews(studio_id, grade);
CREATE INDEX idx_call_reviews_created_at ON call_reviews(studio_id, created_at DESC);

-- RLS
ALTER TABLE call_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view call reviews for their studios"
  ON call_reviews FOR SELECT
  USING (
    studio_id IN (
      SELECT su.studio_id FROM studio_users su
      WHERE su.user_id = auth.uid()
    )
  );

-- Edge Functions use service role key for INSERT/UPDATE (bypasses RLS)

-- pg_cron + pg_net schedule for daily-call-review
-- Run at 7 AM UTC daily (1 AM CST / 2 AM CDT)
-- 1 AM CST gives a 1-hour buffer after midnight for late-arriving call data
-- NOTE: Update the CRON_SECRET before enabling in production
-- SELECT cron.schedule(
--   'daily-call-review',
--   '0 7 * * *',
--   $$
--   SELECT net.http_post(
--     url := 'https://npcpkffnswzvzmqolort.supabase.co/functions/v1/daily-call-review',
--     headers := '{"x-cron-secret": "<CRON_SECRET>", "Content-Type": "application/json"}'::jsonb
--   );
--   $$
-- );
