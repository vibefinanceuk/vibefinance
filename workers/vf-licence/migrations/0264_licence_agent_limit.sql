-- 0264_licence_agent_limit.sql
-- Decision 0622 — Agents, slice 1. Agents are included in every tier and
-- capped by tier (Dan, 4 October 2026): each environment's licence says how
-- many agents it may have, and the signed token carries it to vf-app as
-- `agentLimit`. NULL means the licence names none, and vf-app uses its own
-- default (5).

ALTER TABLE licences ADD COLUMN agent_limit INTEGER CHECK (agent_limit IS NULL OR agent_limit >= 0);

-- ASSERT ALWAYS: SELECT count(*) FROM licences WHERE agent_limit < 0 == 0
