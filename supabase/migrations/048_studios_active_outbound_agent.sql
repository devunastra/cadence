-- Migration 048: studios.active_outbound_agent_id
-- The Retell agent a studio has chosen to place outbound calls to future leads.
-- NULL = fall back to the studio's default (retell_agent_id). Dropdown options come
-- from studio_test_agents (043); the *selection* lives here. n8n reads this column at
-- call time and passes it to Retell create-phone-call as override_agent_id.
--
-- Idempotent: safe to re-run. No RLS change — studios is already scoped and the column
-- is read via select('*').

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS active_outbound_agent_id text;

COMMENT ON COLUMN studios.active_outbound_agent_id IS
  'Retell agent_id selected in the Leads UI to call future leads. NULL = use retell_agent_id. Options sourced from studio_test_agents.';

-- Make it a real reference into the studio's OWN agent registry: a non-null selection
-- must be one of THIS studio's studio_test_agents rows. Composite FK against the existing
-- UNIQUE(studio_id, agent_id) on studio_test_agents. MATCH SIMPLE => a NULL selection
-- skips the check. We store the raw agent_id (not the row UUID) so n8n reads this column
-- and passes it straight to Retell with no join.
-- ON DELETE RESTRICT: an agent that is currently the active selection cannot be removed
-- until the studio picks a different one (reselect, then delete).
ALTER TABLE studios DROP CONSTRAINT IF EXISTS studios_active_outbound_agent_fk;
ALTER TABLE studios
  ADD CONSTRAINT studios_active_outbound_agent_fk
  FOREIGN KEY (id, active_outbound_agent_id)
  REFERENCES studio_test_agents (studio_id, agent_id)
  ON DELETE RESTRICT ON UPDATE CASCADE;
