-- 0129_agent_options.sql
-- Decision 0624 — Agents, slice 3: what a report is narrowed by, and what
-- each person was sent last, to compare with. Options are checked in
-- agents.ts (checkOptions); an agent made before keeps the defaults.

ALTER TABLE agents ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agent_deliveries ADD COLUMN totals_json TEXT;

-- ASSERT: SELECT count(*) FROM agents WHERE options_json <> '{}' == 0
