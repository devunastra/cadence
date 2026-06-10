-- Migration 043: studio_test_agents
-- Per-studio list of Retell agents selectable on the /test page.
-- Replaces the global TEST_AGENTS env var so each studio sees only its own agents.
--
-- IMPORTANT: this table holds NO secrets. agent_id and from_number are identifiers,
-- not credentials. The Retell API key is a single shared agency key and stays in the
-- RETELL_API_KEY env var — it is never stored here. Do NOT add an api_key column.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS studio_test_agents (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  studio_id   uuid NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  label       text NOT NULL,                 -- display name in the /test dropdown
  agent_id    text NOT NULL,                 -- Retell agent id (identifier, not a secret)
  from_number text NOT NULL,                 -- the agent's provisioned Retell number
  sort_order  integer NOT NULL DEFAULT 0,    -- dropdown ordering
  is_active   boolean NOT NULL DEFAULT true, -- hide without deleting
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT studio_test_agents_studio_agent_key UNIQUE (studio_id, agent_id)
);

-- Auto-update updated_at on UPDATE
CREATE OR REPLACE FUNCTION update_studio_test_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_test_agents_updated_at ON studio_test_agents;
CREATE TRIGGER studio_test_agents_updated_at
  BEFORE UPDATE ON studio_test_agents
  FOR EACH ROW EXECUTE FUNCTION update_studio_test_agents_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_studio_test_agents_studio_id
  ON studio_test_agents(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_test_agents_active
  ON studio_test_agents(studio_id, is_active, sort_order);

-- =====================
-- RLS
-- =====================
ALTER TABLE studio_test_agents ENABLE ROW LEVEL SECURITY;

-- Members of a studio can read that studio's agents (super_admin bypasses RLS).
DROP POLICY IF EXISTS "users_can_select_studio_test_agents" ON studio_test_agents;
CREATE POLICY "users_can_select_studio_test_agents"
  ON studio_test_agents FOR SELECT
  USING (studio_id = ANY(get_my_studio_ids()));

-- Only owners (or super_admin) can add agents to their studio.
DROP POLICY IF EXISTS "owners_can_insert_studio_test_agents" ON studio_test_agents;
CREATE POLICY "owners_can_insert_studio_test_agents"
  ON studio_test_agents FOR INSERT
  WITH CHECK (is_studio_owner(studio_id));

-- Only owners (or super_admin) can edit their studio's agents.
DROP POLICY IF EXISTS "owners_can_update_studio_test_agents" ON studio_test_agents;
CREATE POLICY "owners_can_update_studio_test_agents"
  ON studio_test_agents FOR UPDATE
  USING (is_studio_owner(studio_id));

-- Only owners (or super_admin) can remove their studio's agents.
DROP POLICY IF EXISTS "owners_can_delete_studio_test_agents" ON studio_test_agents;
CREATE POLICY "owners_can_delete_studio_test_agents"
  ON studio_test_agents FOR DELETE
  USING (is_studio_owner(studio_id));

-- The /api routes call this table with the service-role client, which bypasses RLS.

-- =====================
-- Seed: migrate the two existing global TEST_AGENTS entries onto Arthur Murray Lincolnshire.
-- Name-based lookup (matches migration 015). No-op on studios where the name doesn't match.
-- =====================
INSERT INTO studio_test_agents (studio_id, label, agent_id, from_number, sort_order)
SELECT s.id, v.label, v.agent_id, v.from_number, v.sort_order
FROM studios s
CROSS JOIN (VALUES
  ('AM Lincolnshire Agent (Joshua-draft)'::text, 'agent_cd8a872b64a03338e6c54a41a0'::text, '+17623713782'::text, 0),
  ('NEW TEST MOJO JFF'::text,                    'agent_c6c4facfa0c12f9d7e1f1a8c83'::text, '+16307964623'::text, 1)
) AS v(label, agent_id, from_number, sort_order)
WHERE s.name = 'Arthur Murray Lincolnshire'
ON CONFLICT (studio_id, agent_id) DO NOTHING;
