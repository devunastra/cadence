-- Migration 044: seed a test agent for Arthur Murray Bonifacio Global City (BGC).
-- Depends on 043 (studio_test_agents). Idempotent: ON CONFLICT no-ops on re-run,
-- and the WHERE guard makes it a no-op if the studio doesn't exist in this DB.
--
-- label is a display-only name and can be renamed anytime.

INSERT INTO studio_test_agents (studio_id, label, agent_id, from_number, sort_order)
SELECT s.id,
       'Arthur Murray BGC Agent',
       'agent_9bd7f902d7e62f788986e85d69',
       '+17623713782',
       0
FROM studios s
WHERE s.id = 'b1290908-73af-4813-b643-a28f9ce703dd'
ON CONFLICT (studio_id, agent_id) DO NOTHING;
