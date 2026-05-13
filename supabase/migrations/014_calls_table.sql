-- =============================================
-- calls table — Phase 2 (Retell AI analytics)
-- =============================================
CREATE TABLE calls (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id           uuid        NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  retell_call_id      text        UNIQUE NOT NULL,
  created_at          timestamptz NOT NULL,
  duration_seconds    integer,
  sentiment           text        CHECK (sentiment IN ('positive','neutral','negative','unknown')),
  outcome             text        CHECK (outcome IN ('successful','unsuccessful')),
  disconnected_reason text        CHECK (disconnected_reason IN (
                                    'agent_hangup','user_hangup','voicemail',
                                    'dial_no_answer','dial_busy','call_transfer'
                                  )),
  picked_up           boolean,
  transferred         boolean,
  voicemail           boolean,
  direction           text        CHECK (direction IN ('inbound','outbound')),
  transcript_summary  text,
  transcript          text,
  lead_id             uuid        REFERENCES leads(id) ON DELETE SET NULL
);

-- Performance index for analytics date-range queries
CREATE INDEX calls_studio_created_at ON calls (studio_id, created_at DESC);
CREATE INDEX calls_lead_id_idx       ON calls (lead_id) WHERE lead_id IS NOT NULL;

-- =============================================
-- Row-Level Security
-- =============================================
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Studio members can read their studio's calls
CREATE POLICY "studio_members_can_select_calls"
  ON calls FOR SELECT
  USING (studio_id = ANY(get_my_studio_ids()));

-- Owners can delete call records
CREATE POLICY "owners_can_delete_calls"
  ON calls FOR DELETE
  USING (is_studio_owner(studio_id));

-- No INSERT policy needed — webhook handler uses service role (bypasses RLS)
