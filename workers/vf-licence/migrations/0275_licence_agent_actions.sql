-- 0275_licence_agent_actions.sql
-- Decision 0631 — Agents phase 3: prepared actions can be left out of a
-- tier (Dan, 5 October 2026). NULL or 1: allowed. 0: the licence leaves
-- them out, and the signed token says `agentActions: false`.

ALTER TABLE licences ADD COLUMN agent_actions INTEGER CHECK (agent_actions IS NULL OR agent_actions IN (0, 1));

-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE agent_actions NOT IN (0, 1) == 0
